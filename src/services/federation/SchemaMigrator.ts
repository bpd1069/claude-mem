/**
 * Schema Migrator for Federation
 *
 * Migrates external database records into local storage by:
 * 1. Transforming via SchemaAdapter (mutable external → immutable internal)
 * 2. Deduplicating via importObservation (title + session + timestamp)
 * 3. Tracking progress for batch operations
 *
 * Use cases:
 * - Import team memory from shared repositories
 * - Migrate from older schema versions
 * - Consolidate multiple databases
 */

import { SchemaAdapter, type RemoteSchemaConfig, type InternalObservation } from './SchemaAdapter.js';
import { SessionStore } from '../sqlite/SessionStore.js';

/**
 * Migration result for a single record
 */
export interface MigrationRecordResult {
  sourceId: unknown;
  success: boolean;
  imported: boolean;  // false if duplicate
  localId?: number;
  error?: string;
}

/**
 * Migration batch result
 */
export interface MigrationBatchResult {
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  records: MigrationRecordResult[];
  durationMs: number;
}

/**
 * Migration options
 */
export interface MigrationOptions {
  /**
   * Project name to assign to migrated records
   * Required because external data may not have project info
   */
  targetProject: string;

  /**
   * Memory session ID to assign to migrated records
   * If not provided, creates a synthetic session ID
   */
  memorySessionId?: string;

  /**
   * Batch size for progress callbacks
   * @default 100
   */
  batchSize?: number;

  /**
   * Progress callback for long-running migrations
   */
  onProgress?: (processed: number, total: number) => void;

  /**
   * Whether to skip records that fail transformation (continue vs abort)
   * @default true
   */
  continueOnError?: boolean;

  /**
   * Dry run mode - validate and transform but don't persist
   * @default false
   */
  dryRun?: boolean;
}

/**
 * Schema Migrator class
 */
export class SchemaMigrator {
  private adapter: SchemaAdapter;
  private store: SessionStore;

  constructor(adapter: SchemaAdapter, store?: SessionStore) {
    this.adapter = adapter;
    this.store = store ?? new SessionStore();
  }

  /**
   * Migrate a single external record
   */
  migrateRecord(
    external: Record<string, unknown>,
    options: MigrationOptions
  ): MigrationRecordResult {
    const sourceId = external[this.adapter.getConfig().fields.id || 'id'];

    try {
      // Transform using adapter
      const internal = this.adapter.transform(external);

      if (options.dryRun) {
        return {
          sourceId,
          success: true,
          imported: true,  // Would be imported
        };
      }

      // Ensure session exists for this migration
      const memorySessionId = options.memorySessionId ?? this.ensureMigrationSession(options.targetProject);

      // Import observation (handles deduplication)
      const result = this.store.importObservation({
        memory_session_id: memorySessionId,
        project: options.targetProject,
        text: null,  // Deprecated field
        type: internal.type,
        title: internal.title,
        subtitle: internal.subtitle,
        facts: internal.facts ? JSON.stringify(internal.facts) : null,
        narrative: internal.narrative,
        concepts: null,  // Not in InternalObservation
        files_read: null,
        files_modified: null,
        prompt_number: null,
        discovery_tokens: 0,
        created_at: new Date(internal.created_at_epoch).toISOString(),
        created_at_epoch: internal.created_at_epoch,
      });

      return {
        sourceId,
        success: true,
        imported: result.imported,
        localId: result.id,
      };
    } catch (err) {
      return {
        sourceId,
        success: false,
        imported: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Migrate a batch of external records
   */
  migrateBatch(
    externals: Record<string, unknown>[],
    options: MigrationOptions
  ): MigrationBatchResult {
    const startTime = Date.now();
    const results: MigrationRecordResult[] = [];
    const batchSize = options.batchSize ?? 100;

    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (let i = 0; i < externals.length; i++) {
      const result = this.migrateRecord(externals[i], options);
      results.push(result);

      if (result.success) {
        if (result.imported) {
          imported++;
        } else {
          duplicates++;
        }
      } else {
        errors++;
        if (!options.continueOnError) {
          break;
        }
      }

      // Progress callback
      if (options.onProgress && (i + 1) % batchSize === 0) {
        options.onProgress(i + 1, externals.length);
      }
    }

    // Final progress callback
    if (options.onProgress) {
      options.onProgress(externals.length, externals.length);
    }

    return {
      total: externals.length,
      imported,
      duplicates,
      errors,
      records: results,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * Validate external records without importing
   * Returns transformation results and any errors
   */
  validateBatch(externals: Record<string, unknown>[]): {
    valid: number;
    invalid: number;
    results: Array<{
      sourceId: unknown;
      valid: boolean;
      transformed?: InternalObservation;
      error?: string;
    }>;
  } {
    let valid = 0;
    let invalid = 0;
    const results: Array<{
      sourceId: unknown;
      valid: boolean;
      transformed?: InternalObservation;
      error?: string;
    }> = [];

    for (const external of externals) {
      const sourceId = external[this.adapter.getConfig().fields.id || 'id'];

      try {
        const transformed = this.adapter.transform(external);
        valid++;
        results.push({
          sourceId,
          valid: true,
          transformed,
        });
      } catch (err) {
        invalid++;
        results.push({
          sourceId,
          valid: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { valid, invalid, results };
  }

  /**
   * Ensure a migration session exists for importing data
   */
  private ensureMigrationSession(project: string): string {
    const syntheticSessionId = `migration-${this.adapter.getConfig().id}-${Date.now()}`;
    const contentSessionId = `imported-${syntheticSessionId}`;

    // Create session
    this.store.createSDKSession(contentSessionId, project, 'Imported via schema migration');

    // Update with synthetic memory session ID
    const stmt = this.store.db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?');
    stmt.run(syntheticSessionId, contentSessionId);

    return syntheticSessionId;
  }

  /**
   * Get adapter configuration
   */
  getAdapterConfig(): RemoteSchemaConfig {
    return this.adapter.getConfig();
  }

  /**
   * Close the store connection
   */
  close(): void {
    this.store.close();
  }
}

/**
 * Create a migrator from adapter configuration
 */
export function createMigrator(config: RemoteSchemaConfig, store?: SessionStore): SchemaMigrator {
  const adapter = new SchemaAdapter(config);
  return new SchemaMigrator(adapter, store);
}

/**
 * Create a migrator for claude-mem compatible sources (same schema)
 */
export function createDefaultMigrator(sourceId: string, sourceUrl: string, store?: SessionStore): SchemaMigrator {
  const config = {
    id: sourceId,
    name: `Import: ${sourceId}`,
    url: sourceUrl,
    fields: {
      id: 'id',
      title: 'title',
      subtitle: 'subtitle',
      narrative: 'narrative',
      facts: 'facts',
      type: 'type',
      project: 'project',
      timestamp: 'created_at_epoch',
    },
    transforms: {
      timestamp: 'epoch_ms' as const,
      facts: 'json' as const,
    },
  };

  return createMigrator(config, store);
}
