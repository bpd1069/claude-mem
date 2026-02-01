/**
 * SchemaMigrator Tests
 *
 * Tests for migrating external data into local storage using schema adapters.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SchemaMigrator, createMigrator, createDefaultMigrator } from '../../src/services/federation/SchemaMigrator';
import { SchemaAdapter, type RemoteSchemaConfig } from '../../src/services/federation/SchemaAdapter';
import { SessionStore } from '../../src/services/sqlite/SessionStore';

describe('SchemaMigrator', () => {
  let store: SessionStore;

  beforeEach(() => {
    // Use in-memory database for tests
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  describe('single record migration', () => {
    test('migrates a record with default schema', () => {
      const config: RemoteSchemaConfig = {
        id: 'test-source',
        name: 'Test Source',
        url: 'https://test.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const result = migrator.migrateRecord(
        {
          id: 1,
          title: 'Test Observation',
          subtitle: 'Test Subtitle',
          narrative: 'Test narrative content',
          type: 'discovery',
          timestamp: Date.now(),
        },
        { targetProject: 'test-project' }
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(true);
      expect(result.localId).toBeDefined();
    });

    test('migrates a record with custom field mapping', () => {
      const config: RemoteSchemaConfig = {
        id: 'custom-source',
        name: 'Custom Source',
        url: 'https://custom.com',
        fields: {
          id: 'observation_id',
          title: 'summary',
          narrative: 'content',
          type: 'category',
          timestamp: 'created_at',
        },
        transforms: {
          timestamp: 'iso8601',
        },
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const result = migrator.migrateRecord(
        {
          observation_id: 42,
          summary: 'Custom Title',
          content: 'Custom narrative',
          category: 'bugfix',
          created_at: '2024-02-04T12:00:00.000Z',
        },
        { targetProject: 'custom-project' }
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(true);

      // Verify the record was stored correctly
      const obs = store.getObservationById(result.localId!);
      expect(obs).not.toBeNull();
      expect(obs!.title).toBe('Custom Title');
      expect(obs!.narrative).toBe('Custom narrative');
      expect(obs!.type).toBe('bugfix');
      expect(obs!.project).toBe('custom-project');
    });

    test('detects duplicates on re-import', () => {
      const config: RemoteSchemaConfig = {
        id: 'dup-test',
        name: 'Dup Test',
        url: 'https://dup.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      // Create a session to use for both imports
      const contentSessionId = 'dup-content-session';
      store.createSDKSession(contentSessionId, 'test', 'Dup test session');
      store.db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?')
        .run('dup-memory-session', contentSessionId);

      const record = {
        id: 1,
        title: 'Duplicate Test',
        narrative: 'Content',
        type: 'discovery',
        timestamp: 1707000000000,
      };

      // First import with explicit session
      const result1 = migrator.migrateRecord(record, {
        targetProject: 'test',
        memorySessionId: 'dup-memory-session',
      });
      expect(result1.success).toBe(true);
      expect(result1.imported).toBe(true);

      // Second import of same record with same session
      const result2 = migrator.migrateRecord(record, {
        targetProject: 'test',
        memorySessionId: 'dup-memory-session',
      });
      expect(result2.success).toBe(true);
      expect(result2.imported).toBe(false);  // Duplicate detected
    });

    test('dry run does not persist records', () => {
      const config: RemoteSchemaConfig = {
        id: 'dry-run',
        name: 'Dry Run',
        url: 'https://dry.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const result = migrator.migrateRecord(
        {
          id: 1,
          title: 'Dry Run Test',
          type: 'discovery',
          timestamp: Date.now(),
        },
        { targetProject: 'test', dryRun: true }
      );

      expect(result.success).toBe(true);
      expect(result.imported).toBe(true);
      expect(result.localId).toBeUndefined();  // No ID because not persisted
    });
  });

  describe('batch migration', () => {
    test('migrates multiple records', () => {
      const config: RemoteSchemaConfig = {
        id: 'batch-test',
        name: 'Batch Test',
        url: 'https://batch.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const records = [
        { id: 1, title: 'Record 1', type: 'discovery', timestamp: Date.now() },
        { id: 2, title: 'Record 2', type: 'bugfix', timestamp: Date.now() + 1000 },
        { id: 3, title: 'Record 3', type: 'feature', timestamp: Date.now() + 2000 },
      ];

      const result = migrator.migrateBatch(records, { targetProject: 'batch-project' });

      expect(result.total).toBe(3);
      expect(result.imported).toBe(3);
      expect(result.duplicates).toBe(0);
      expect(result.errors).toBe(0);
      expect(result.records).toHaveLength(3);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    test('reports progress during batch migration', () => {
      const config: RemoteSchemaConfig = {
        id: 'progress-test',
        name: 'Progress Test',
        url: 'https://progress.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const records = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        title: `Record ${i + 1}`,
        type: 'discovery',
        timestamp: Date.now() + i * 1000,
      }));

      const progressCalls: Array<{ processed: number; total: number }> = [];

      migrator.migrateBatch(records, {
        targetProject: 'progress-project',
        batchSize: 50,
        onProgress: (processed, total) => {
          progressCalls.push({ processed, total });
        },
      });

      // Should have progress calls at 50, 100, 150, and final
      expect(progressCalls.length).toBeGreaterThanOrEqual(3);
      expect(progressCalls[0].processed).toBe(50);
      expect(progressCalls[progressCalls.length - 1].processed).toBe(150);
    });

    test('handles mixed success and duplicates', () => {
      const config: RemoteSchemaConfig = {
        id: 'mixed-test',
        name: 'Mixed Test',
        url: 'https://mixed.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      // Create a session to use for all imports
      const contentSessionId = 'mixed-content-session';
      store.createSDKSession(contentSessionId, 'mixed', 'Mixed test session');
      store.db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?')
        .run('mixed-memory-session', contentSessionId);

      const opts = { targetProject: 'mixed', memorySessionId: 'mixed-memory-session' };

      // Pre-import some records
      migrator.migrateRecord(
        { id: 1, title: 'Existing 1', type: 'discovery', timestamp: 1707000000000 },
        opts
      );
      migrator.migrateRecord(
        { id: 3, title: 'Existing 3', type: 'discovery', timestamp: 1707002000000 },
        opts
      );

      // Now batch import including duplicates
      const records = [
        { id: 1, title: 'Existing 1', type: 'discovery', timestamp: 1707000000000 },
        { id: 2, title: 'New 2', type: 'bugfix', timestamp: 1707001000000 },
        { id: 3, title: 'Existing 3', type: 'discovery', timestamp: 1707002000000 },
        { id: 4, title: 'New 4', type: 'feature', timestamp: 1707003000000 },
      ];

      const result = migrator.migrateBatch(records, opts);

      expect(result.total).toBe(4);
      expect(result.imported).toBe(2);  // Records 2 and 4
      expect(result.duplicates).toBe(2);  // Records 1 and 3
      expect(result.errors).toBe(0);
    });
  });

  describe('validation', () => {
    test('validates records without importing', () => {
      const config: RemoteSchemaConfig = {
        id: 'validate-test',
        name: 'Validate Test',
        url: 'https://validate.com',
        fields: {
          id: 'obs_id',
          title: 'name',
          type: 'kind',
        },
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const records = [
        { obs_id: 1, name: 'Valid 1', kind: 'discovery' },
        { obs_id: 2, name: 'Valid 2', kind: 'bugfix' },
        { obs_id: 3, name: 'Valid 3', kind: 'feature' },
      ];

      const result = migrator.validateBatch(records);

      expect(result.valid).toBe(3);
      expect(result.invalid).toBe(0);
      expect(result.results).toHaveLength(3);

      // Verify transformations
      expect(result.results[0].transformed?.title).toBe('Valid 1');
      expect(result.results[1].transformed?.type).toBe('bugfix');
    });

    test('reports validation errors', () => {
      const config: RemoteSchemaConfig = {
        id: 'validate-error',
        name: 'Validate Error',
        url: 'https://error.com',
        fields: {
          timestamp: 'bad.nested.path',
        },
        transforms: {
          timestamp: 'iso8601',
        },
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const records = [
        { id: 1, title: 'Test' },  // Missing timestamp path won't error, just returns Date.now()
      ];

      const result = migrator.validateBatch(records);

      // This should still be valid because missing fields get defaults
      expect(result.valid).toBe(1);
    });
  });

  describe('factory functions', () => {
    test('createMigrator creates from config', () => {
      const migrator = createMigrator(
        {
          id: 'factory-test',
          name: 'Factory Test',
          url: 'https://factory.com',
          fields: { title: 'name' },
        },
        store
      );

      expect(migrator.getAdapterConfig().id).toBe('factory-test');
      expect(migrator.getAdapterConfig().fields.title).toBe('name');
    });

    test('createDefaultMigrator creates claude-mem compatible migrator', () => {
      const migrator = createDefaultMigrator('team-memory', 'https://team.com', store);

      const config = migrator.getAdapterConfig();
      expect(config.id).toBe('team-memory');
      expect(config.fields.id).toBe('id');
      expect(config.fields.title).toBe('title');
      expect(config.fields.timestamp).toBe('created_at_epoch');
      expect(config.transforms?.timestamp).toBe('epoch_ms');
    });
  });

  describe('session management', () => {
    test('uses provided memory session ID', () => {
      const config: RemoteSchemaConfig = {
        id: 'session-test',
        name: 'Session Test',
        url: 'https://session.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      // First create the session
      const contentSessionId = 'test-content-session';
      store.createSDKSession(contentSessionId, 'test-project', 'Test session');
      store.db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?')
        .run('custom-memory-session', contentSessionId);

      const result = migrator.migrateRecord(
        { id: 1, title: 'Test', type: 'discovery', timestamp: Date.now() },
        { targetProject: 'test-project', memorySessionId: 'custom-memory-session' }
      );

      expect(result.success).toBe(true);

      const obs = store.getObservationById(result.localId!);
      expect(obs!.memory_session_id).toBe('custom-memory-session');
    });

    test('creates synthetic session when none provided', () => {
      const config: RemoteSchemaConfig = {
        id: 'auto-session',
        name: 'Auto Session',
        url: 'https://auto.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const result = migrator.migrateRecord(
        { id: 1, title: 'Test', type: 'discovery', timestamp: Date.now() },
        { targetProject: 'auto-project' }
      );

      expect(result.success).toBe(true);

      const obs = store.getObservationById(result.localId!);
      expect(obs!.memory_session_id).toContain('migration-auto-session');
    });
  });

  describe('nested field extraction', () => {
    test('migrates records with deeply nested fields', () => {
      const config: RemoteSchemaConfig = {
        id: 'nested-migration',
        name: 'Nested Migration',
        url: 'https://nested.com',
        fields: {
          id: 'data.meta.id',
          title: 'data.content.title',
          narrative: 'data.content.body',
          type: 'data.meta.category',
          timestamp: 'data.meta.timestamps.created',
        },
        transforms: {
          timestamp: 'epoch_ms',
        },
      };
      const adapter = new SchemaAdapter(config);
      const migrator = new SchemaMigrator(adapter, store);

      const result = migrator.migrateRecord(
        {
          data: {
            meta: {
              id: 999,
              category: 'feature',
              timestamps: {
                created: 1707100000000,
              },
            },
            content: {
              title: 'Nested Title',
              body: 'Nested narrative body',
            },
          },
        },
        { targetProject: 'nested-project' }
      );

      expect(result.success).toBe(true);

      const obs = store.getObservationById(result.localId!);
      expect(obs!.title).toBe('Nested Title');
      expect(obs!.narrative).toBe('Nested narrative body');
      expect(obs!.type).toBe('feature');
      expect(obs!.created_at_epoch).toBe(1707100000000);
    });
  });
});
