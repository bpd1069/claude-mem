/**
 * SqliteVecBackend
 *
 * Vector backend implementation using sqlite-vec extension.
 * Stores embeddings in a local SQLite database with vector search capabilities.
 *
 * Features:
 * - Local storage (no external dependencies)
 * - Works on all platforms including Windows
 * - Exportable via git-lfs
 * - Uses configurable embedding providers
 */

import Database from 'bun:sqlite';
import path from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';
import type { ParsedObservation, ParsedSummary } from '../../sdk/parser.js';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import type {
  VectorBackend,
  VectorQueryResult,
  VectorFilters,
  VectorStats
} from './VectorBackend.js';
import {
  createEmbeddingProvider,
  embeddingToBlob,
  blobToEmbedding,
  type IEmbeddingProvider
} from './EmbeddingProvider.js';

interface StoredObservation {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string | null;
  narrative: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  prompt_number: number;
  discovery_tokens: number;
  created_at: string;
  created_at_epoch: number;
}

interface StoredSummary {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  notes: string | null;
  prompt_number: number;
  discovery_tokens: number;
  created_at: string;
  created_at_epoch: number;
}

interface VectorDocument {
  id: string;
  content: string;
  sqliteId: number;
  docType: 'observation' | 'session_summary' | 'user_prompt';
  memorySessionId: string;
  project: string;
  createdAtEpoch: number;
  metadata: Record<string, string | number>;
}

export class SqliteVecBackend implements VectorBackend {
  readonly name = 'sqlite-vec';

  private db: Database | null = null;
  private embeddingProvider: IEmbeddingProvider | null = null;
  private project: string;
  private dbPath: string;
  private dimensions: number;
  private readonly BATCH_SIZE = 50; // Smaller batches for embedding API calls

  constructor(project: string) {
    this.project = project;
    const dataDir = path.join(os.homedir(), '.claude-mem');
    this.dbPath = path.join(dataDir, 'vectors.db');
    this.dimensions = 768; // Default, will be updated from settings
  }

  isDisabled(): boolean {
    return false; // sqlite-vec works on all platforms
  }

  async initialize(): Promise<void> {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    this.dimensions = (settings as any).EMBEDDING_DIMENSIONS || 768;

    // Ensure directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }

    // Initialize embedding provider
    this.embeddingProvider = createEmbeddingProvider();

    // Open database
    this.db = new Database(this.dbPath);

    // Enable WAL mode for better concurrency
    this.db.exec('PRAGMA journal_mode = WAL');

    // Load sqlite-vec extension
    try {
      // Try to load the extension - path varies by installation
      const extensionPaths = [
        'vec0', // If in LD_LIBRARY_PATH or system path
        '/usr/local/lib/sqlite-vec/vec0',
        '/usr/lib/sqlite-vec/vec0',
        path.join(os.homedir(), '.local/lib/sqlite-vec/vec0'),
      ];

      let loaded = false;
      for (const extPath of extensionPaths) {
        try {
          this.db.loadExtension(extPath);
          loaded = true;
          logger.info('SQLITE_VEC', 'Extension loaded', { path: extPath });
          break;
        } catch {
          // Try next path
        }
      }

      if (!loaded) {
        // Fall back to npm package if available
        try {
          // @ts-ignore - dynamic import of native module
          const sqliteVec = await import('sqlite-vec');
          sqliteVec.load(this.db);
          loaded = true;
          logger.info('SQLITE_VEC', 'Extension loaded from npm package');
        } catch {
          logger.warn('SQLITE_VEC', 'sqlite-vec extension not found, vector search will be disabled');
        }
      }
    } catch (error) {
      logger.warn('SQLITE_VEC', 'Failed to load sqlite-vec extension', {}, error as Error);
    }

    // Create tables
    this.createTables();

    logger.info('SQLITE_VEC', 'Backend initialized', {
      project: this.project,
      dbPath: this.dbPath,
      dimensions: this.dimensions
    });
  }

  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    // Metadata table for document info
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS vector_documents (
        id TEXT PRIMARY KEY,
        sqlite_id INTEGER NOT NULL,
        doc_type TEXT NOT NULL,
        content TEXT NOT NULL,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        metadata TEXT,
        embedding BLOB,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vector_docs_project ON vector_documents(project);
      CREATE INDEX IF NOT EXISTS idx_vector_docs_type ON vector_documents(doc_type);
      CREATE INDEX IF NOT EXISTS idx_vector_docs_sqlite_id ON vector_documents(sqlite_id, doc_type);
      CREATE INDEX IF NOT EXISTS idx_vector_docs_epoch ON vector_documents(created_at_epoch);
    `);

    // Try to create vec0 virtual table for fast similarity search
    try {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
          embedding float[${this.dimensions}]
        )
      `);
      logger.debug('SQLITE_VEC', 'vec0 virtual table created');
    } catch (error) {
      // vec0 not available, will fall back to brute force search
      logger.debug('SQLITE_VEC', 'vec0 not available, using fallback search');
    }

    // Sync tracking table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    logger.info('SQLITE_VEC', 'Database closed');
  }

  private formatObservationDocs(obs: StoredObservation): VectorDocument[] {
    const documents: VectorDocument[] = [];
    const facts = obs.facts ? JSON.parse(obs.facts) : [];
    const concepts = obs.concepts ? JSON.parse(obs.concepts) : [];

    const baseMetadata: Record<string, string | number> = {
      type: obs.type || 'discovery',
      title: obs.title || 'Untitled'
    };

    if (obs.subtitle) baseMetadata.subtitle = obs.subtitle;
    if (concepts.length > 0) baseMetadata.concepts = concepts.join(',');

    if (obs.narrative) {
      documents.push({
        id: `obs_${obs.id}_narrative`,
        content: obs.narrative,
        sqliteId: obs.id,
        docType: 'observation',
        memorySessionId: obs.memory_session_id,
        project: obs.project,
        createdAtEpoch: obs.created_at_epoch,
        metadata: { ...baseMetadata, field_type: 'narrative' }
      });
    }

    if (obs.text) {
      documents.push({
        id: `obs_${obs.id}_text`,
        content: obs.text,
        sqliteId: obs.id,
        docType: 'observation',
        memorySessionId: obs.memory_session_id,
        project: obs.project,
        createdAtEpoch: obs.created_at_epoch,
        metadata: { ...baseMetadata, field_type: 'text' }
      });
    }

    facts.forEach((fact: string, index: number) => {
      documents.push({
        id: `obs_${obs.id}_fact_${index}`,
        content: fact,
        sqliteId: obs.id,
        docType: 'observation',
        memorySessionId: obs.memory_session_id,
        project: obs.project,
        createdAtEpoch: obs.created_at_epoch,
        metadata: { ...baseMetadata, field_type: 'fact', fact_index: index }
      });
    });

    return documents;
  }

  private formatSummaryDocs(summary: StoredSummary): VectorDocument[] {
    const documents: VectorDocument[] = [];

    const fields = ['request', 'investigated', 'learned', 'completed', 'next_steps', 'notes'] as const;
    for (const field of fields) {
      if (summary[field]) {
        documents.push({
          id: `summary_${summary.id}_${field}`,
          content: summary[field]!,
          sqliteId: summary.id,
          docType: 'session_summary',
          memorySessionId: summary.memory_session_id,
          project: summary.project,
          createdAtEpoch: summary.created_at_epoch,
          metadata: { field_type: field, prompt_number: summary.prompt_number || 0 }
        });
      }
    }

    return documents;
  }

  private async addDocuments(documents: VectorDocument[]): Promise<void> {
    if (!this.db || !this.embeddingProvider || documents.length === 0) return;

    // Generate embeddings in batches
    const texts = documents.map(d => d.content);
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += this.BATCH_SIZE) {
      const batch = texts.slice(i, i + this.BATCH_SIZE);
      try {
        const results = await this.embeddingProvider.embed(batch);
        embeddings.push(...results.map(r => r.embedding));
      } catch (error) {
        logger.error('SQLITE_VEC', 'Failed to generate embeddings', {
          batchStart: i,
          batchSize: batch.length
        }, error as Error);
        // Fill with empty embeddings on error
        for (let j = 0; j < batch.length; j++) {
          embeddings.push([]);
        }
      }
    }

    // Insert documents with embeddings
    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO vector_documents
        (id, sqlite_id, doc_type, content, memory_session_id, project, created_at_epoch, metadata, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertVec = this.db.prepare(`
      INSERT OR REPLACE INTO vec_embeddings (rowid, embedding)
      VALUES (?, ?)
    `).catch(() => null); // May fail if vec0 not available

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const embedding = embeddings[i] || [];
        const embeddingBlob = embedding.length > 0 ? embeddingToBlob(embedding) : null;

        insertStmt.run(
          doc.id,
          doc.sqliteId,
          doc.docType,
          doc.content,
          doc.memorySessionId,
          doc.project,
          doc.createdAtEpoch,
          JSON.stringify(doc.metadata),
          embeddingBlob
        );

        // Try to insert into vec0 virtual table
        if (insertVec && embeddingBlob) {
          try {
            // Get the rowid from the inserted document
            const result = this.db!.prepare('SELECT rowid FROM vector_documents WHERE id = ?').get(doc.id) as { rowid: number } | undefined;
            if (result) {
              insertVec.run(result.rowid, embeddingBlob);
            }
          } catch {
            // vec0 insert failed, will use fallback search
          }
        }
      }
      this.db.exec('COMMIT');

      logger.debug('SQLITE_VEC', 'Documents added', { count: documents.length });
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async syncObservation(
    observationId: number,
    memorySessionId: string,
    project: string,
    obs: ParsedObservation,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens: number = 0
  ): Promise<void> {
    const stored: StoredObservation = {
      id: observationId,
      memory_session_id: memorySessionId,
      project: project,
      text: null,
      type: obs.type,
      title: obs.title,
      subtitle: obs.subtitle,
      facts: JSON.stringify(obs.facts),
      narrative: obs.narrative,
      concepts: JSON.stringify(obs.concepts),
      files_read: JSON.stringify(obs.files_read),
      files_modified: JSON.stringify(obs.files_modified),
      prompt_number: promptNumber,
      discovery_tokens: discoveryTokens,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatObservationDocs(stored);
    logger.info('SQLITE_VEC', 'Syncing observation', {
      observationId,
      documentCount: documents.length,
      project
    });

    await this.addDocuments(documents);
  }

  async syncSummary(
    summaryId: number,
    memorySessionId: string,
    project: string,
    summary: ParsedSummary,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens: number = 0
  ): Promise<void> {
    const stored: StoredSummary = {
      id: summaryId,
      memory_session_id: memorySessionId,
      project: project,
      request: summary.request,
      investigated: summary.investigated,
      learned: summary.learned,
      completed: summary.completed,
      next_steps: summary.next_steps,
      notes: summary.notes,
      prompt_number: promptNumber,
      discovery_tokens: discoveryTokens,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatSummaryDocs(stored);
    logger.info('SQLITE_VEC', 'Syncing summary', {
      summaryId,
      documentCount: documents.length,
      project
    });

    await this.addDocuments(documents);
  }

  async syncUserPrompt(
    promptId: number,
    memorySessionId: string,
    project: string,
    promptText: string,
    promptNumber: number,
    createdAtEpoch: number
  ): Promise<void> {
    const doc: VectorDocument = {
      id: `prompt_${promptId}`,
      content: promptText,
      sqliteId: promptId,
      docType: 'user_prompt',
      memorySessionId,
      project,
      createdAtEpoch,
      metadata: { prompt_number: promptNumber }
    };

    logger.info('SQLITE_VEC', 'Syncing user prompt', { promptId, project });
    await this.addDocuments([doc]);
  }

  async query(
    queryText: string,
    limit: number,
    filters?: VectorFilters
  ): Promise<VectorQueryResult[]> {
    if (!this.db || !this.embeddingProvider) return [];

    // Generate query embedding
    let queryEmbedding: number[];
    try {
      const result = await this.embeddingProvider.embedSingle(queryText);
      queryEmbedding = result.embedding;
    } catch (error) {
      logger.error('SQLITE_VEC', 'Failed to generate query embedding', {}, error as Error);
      return [];
    }

    const queryBlob = embeddingToBlob(queryEmbedding);

    // Build filter conditions
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters?.project) {
      conditions.push('d.project = ?');
      params.push(filters.project);
    }
    if (filters?.docType) {
      conditions.push('d.doc_type = ?');
      params.push(filters.docType);
    }
    if (filters?.memorySessionId) {
      conditions.push('d.memory_session_id = ?');
      params.push(filters.memorySessionId);
    }
    if (filters?.minEpoch) {
      conditions.push('d.created_at_epoch >= ?');
      params.push(filters.minEpoch);
    }
    if (filters?.maxEpoch) {
      conditions.push('d.created_at_epoch <= ?');
      params.push(filters.maxEpoch);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Try vec0 KNN search first
    let results: VectorQueryResult[] = [];
    try {
      const knnQuery = `
        SELECT
          d.id,
          d.sqlite_id,
          d.doc_type,
          d.content,
          d.metadata,
          v.distance
        FROM vec_embeddings v
        JOIN vector_documents d ON d.rowid = v.rowid
        ${whereClause}
        WHERE v.embedding MATCH ?
        ORDER BY v.distance
        LIMIT ?
      `;
      const rows = this.db.prepare(knnQuery).all(...params, queryBlob, limit) as any[];
      results = rows.map(row => ({
        id: row.id,
        sqliteId: row.sqlite_id,
        docType: row.doc_type,
        distance: row.distance,
        metadata: JSON.parse(row.metadata || '{}'),
        content: row.content
      }));
    } catch {
      // Fall back to brute force cosine similarity
      logger.debug('SQLITE_VEC', 'Using fallback brute-force search');
      results = await this.bruteForceSearch(queryEmbedding, limit, whereClause, params);
    }

    // Deduplicate by sqlite_id
    const seenSqliteIds = new Set<number>();
    return results.filter(r => {
      if (seenSqliteIds.has(r.sqliteId)) return false;
      seenSqliteIds.add(r.sqliteId);
      return true;
    });
  }

  private async bruteForceSearch(
    queryEmbedding: number[],
    limit: number,
    whereClause: string,
    params: any[]
  ): Promise<VectorQueryResult[]> {
    if (!this.db) return [];

    const query = `
      SELECT id, sqlite_id, doc_type, content, metadata, embedding
      FROM vector_documents
      ${whereClause}
      ${whereClause ? 'AND' : 'WHERE'} embedding IS NOT NULL
    `;

    const rows = this.db.prepare(query).all(...params) as any[];

    // Calculate cosine similarity for each row
    const scored = rows.map(row => {
      const embedding = blobToEmbedding(row.embedding);
      const similarity = this.cosineSimilarity(queryEmbedding, embedding);
      return {
        id: row.id,
        sqliteId: row.sqlite_id,
        docType: row.doc_type,
        distance: 1 - similarity, // Convert similarity to distance
        metadata: JSON.parse(row.metadata || '{}'),
        content: row.content
      };
    });

    // Sort by distance (ascending) and take top N
    return scored
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  async ensureBackfilled(): Promise<void> {
    if (!this.db) return;

    logger.info('SQLITE_VEC', 'Starting backfill', { project: this.project });

    // Get existing document IDs
    const existingIds = new Set<string>(
      (this.db.prepare('SELECT id FROM vector_documents WHERE project = ?').all(this.project) as { id: string }[])
        .map(r => r.id)
    );

    const mainDb = new SessionStore();

    try {
      // Backfill observations
      const observations = mainDb.db.prepare(`
        SELECT * FROM observations WHERE project = ? ORDER BY id ASC
      `).all(this.project) as StoredObservation[];

      const obsDocs: VectorDocument[] = [];
      for (const obs of observations) {
        const docs = this.formatObservationDocs(obs);
        for (const doc of docs) {
          if (!existingIds.has(doc.id)) {
            obsDocs.push(doc);
          }
        }
      }

      for (let i = 0; i < obsDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(obsDocs.slice(i, i + this.BATCH_SIZE));
      }

      // Backfill summaries
      const summaries = mainDb.db.prepare(`
        SELECT * FROM session_summaries WHERE project = ? ORDER BY id ASC
      `).all(this.project) as StoredSummary[];

      const summaryDocs: VectorDocument[] = [];
      for (const summary of summaries) {
        const docs = this.formatSummaryDocs(summary);
        for (const doc of docs) {
          if (!existingIds.has(doc.id)) {
            summaryDocs.push(doc);
          }
        }
      }

      for (let i = 0; i < summaryDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(summaryDocs.slice(i, i + this.BATCH_SIZE));
      }

      // Backfill prompts
      const prompts = mainDb.db.prepare(`
        SELECT up.*, s.project, s.memory_session_id
        FROM user_prompts up
        JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
        WHERE s.project = ?
        ORDER BY up.id ASC
      `).all(this.project) as any[];

      const promptDocs: VectorDocument[] = [];
      for (const prompt of prompts) {
        const id = `prompt_${prompt.id}`;
        if (!existingIds.has(id)) {
          promptDocs.push({
            id,
            content: prompt.prompt_text,
            sqliteId: prompt.id,
            docType: 'user_prompt',
            memorySessionId: prompt.memory_session_id,
            project: prompt.project,
            createdAtEpoch: prompt.created_at_epoch,
            metadata: { prompt_number: prompt.prompt_number }
          });
        }
      }

      for (let i = 0; i < promptDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(promptDocs.slice(i, i + this.BATCH_SIZE));
      }

      // Update sync metadata
      this.db.prepare(`
        INSERT OR REPLACE INTO sync_metadata (key, value, updated_at)
        VALUES ('last_backfill', ?, datetime('now'))
      `).run(new Date().toISOString());

      logger.info('SQLITE_VEC', 'Backfill complete', {
        project: this.project,
        observations: obsDocs.length,
        summaries: summaryDocs.length,
        prompts: promptDocs.length
      });
    } finally {
      mainDb.close();
    }
  }

  async getStats(): Promise<VectorStats> {
    if (!this.db) {
      return {
        backend: this.name,
        documentCount: 0,
        collectionName: `vectors_${this.project}`,
        dimensions: this.dimensions
      };
    }

    const count = this.db.prepare('SELECT COUNT(*) as count FROM vector_documents WHERE project = ?')
      .get(this.project) as { count: number };

    const lastSync = this.db.prepare("SELECT value FROM sync_metadata WHERE key = 'last_backfill'")
      .get() as { value: string } | undefined;

    return {
      backend: this.name,
      documentCount: count?.count || 0,
      collectionName: `vectors_${this.project}`,
      dimensions: this.dimensions,
      lastSync: lastSync?.value ? new Date(lastSync.value).getTime() : undefined
    };
  }

  async deleteDocuments(ids: string[]): Promise<void> {
    if (!this.db || ids.length === 0) return;

    const placeholders = ids.map(() => '?').join(',');
    this.db.prepare(`DELETE FROM vector_documents WHERE id IN (${placeholders})`).run(...ids);

    logger.debug('SQLITE_VEC', 'Documents deleted', { count: ids.length });
  }

  /**
   * Attach a remote database for federated queries
   */
  async attachRemote(remotePath: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const alias = `remote_${path.basename(remotePath, '.db')}`;
    this.db.exec(`ATTACH DATABASE '${remotePath}' AS ${alias}`);

    logger.info('SQLITE_VEC', 'Remote database attached', { path: remotePath, alias });
  }

  /**
   * Get the database file path (for git-lfs export)
   */
  getDatabasePath(): string {
    return this.dbPath;
  }
}
