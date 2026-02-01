/**
 * ChromaBackend
 *
 * Vector backend implementation using ChromaDB via MCP.
 * Refactored from ChromaSync.ts to implement VectorBackend interface.
 *
 * Design: Fail-fast with no fallbacks - if Chroma is unavailable, operations fail.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ParsedObservation, ParsedSummary } from '../../sdk/parser.js';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import path from 'path';
import os from 'os';
import type {
  VectorBackend,
  VectorDocument,
  VectorQueryResult,
  VectorFilters,
  VectorStats
} from './VectorBackend.js';

// Version injected at build time by esbuild define
declare const __DEFAULT_PACKAGE_VERSION__: string;
const packageVersion = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined' ? __DEFAULT_PACKAGE_VERSION__ : '0.0.0-dev';

interface ChromaDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
}

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

interface StoredUserPrompt {
  id: number;
  content_session_id: string;
  prompt_number: number;
  prompt_text: string;
  created_at: string;
  created_at_epoch: number;
  memory_session_id: string;
  project: string;
}

export class ChromaBackend implements VectorBackend {
  readonly name = 'chroma';

  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected: boolean = false;
  private project: string;
  private collectionName: string;
  private readonly VECTOR_DB_DIR: string;
  private readonly BATCH_SIZE = 100;
  private readonly disabled: boolean;

  constructor(project: string) {
    this.project = project;
    this.collectionName = `cm__${project}`;
    this.VECTOR_DB_DIR = path.join(os.homedir(), '.claude-mem', 'vector-db');

    // Disable on Windows to prevent console popups from MCP subprocess spawning
    this.disabled = process.platform === 'win32';
    if (this.disabled) {
      logger.warn('CHROMA', 'Vector search disabled on Windows (prevents console popups)', {
        project: this.project,
        reason: 'MCP SDK subprocess spawning causes visible console windows'
      });
    }
  }

  isDisabled(): boolean {
    return this.disabled;
  }

  async initialize(): Promise<void> {
    // Lazy initialization - connection happens on first use
    logger.debug('CHROMA', 'ChromaBackend initialized (lazy connection)', { project: this.project });
  }

  private async ensureConnection(): Promise<void> {
    if (this.connected && this.client) {
      return;
    }

    logger.info('CHROMA', 'Connecting to Chroma MCP server...', { project: this.project });

    try {
      const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
      const pythonVersion = settings.CLAUDE_MEM_PYTHON_VERSION;
      const isWindows = process.platform === 'win32';

      const transportOptions: any = {
        command: 'uvx',
        args: [
          '--python', pythonVersion,
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.VECTOR_DB_DIR
        ],
        stderr: 'ignore'
      };

      if (isWindows) {
        transportOptions.windowsHide = true;
      }

      this.transport = new StdioClientTransport(transportOptions);
      this.client = new Client({
        name: 'claude-mem-chroma-sync',
        version: packageVersion
      }, {
        capabilities: {}
      });

      await this.client.connect(this.transport);
      this.connected = true;

      logger.info('CHROMA', 'Connected to Chroma MCP server', { project: this.project });
    } catch (error) {
      logger.error('CHROMA', 'Failed to connect to Chroma MCP server', { project: this.project }, error as Error);
      throw new Error(`Chroma connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async ensureCollection(): Promise<void> {
    await this.ensureConnection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      await this.client.callTool({
        name: 'chroma_get_collection_info',
        arguments: { collection_name: this.collectionName }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000');

      if (isConnectionError) {
        this.connected = false;
        this.client = null;
        throw new Error(`Chroma connection lost: ${errorMessage}`);
      }

      logger.info('CHROMA', 'Creating collection', { collection: this.collectionName });
      try {
        await this.client.callTool({
          name: 'chroma_create_collection',
          arguments: {
            collection_name: this.collectionName,
            embedding_function_name: 'default'
          }
        });
      } catch (createError) {
        throw new Error(`Collection creation failed: ${createError instanceof Error ? createError.message : String(createError)}`);
      }
    }
  }

  async close(): Promise<void> {
    if (!this.connected && !this.client && !this.transport) {
      return;
    }

    if (this.client) {
      await this.client.close();
    }

    if (this.transport) {
      await this.transport.close();
    }

    logger.info('CHROMA', 'Chroma client closed', { project: this.project });

    this.connected = false;
    this.client = null;
    this.transport = null;
  }

  private formatObservationDocs(obs: StoredObservation): ChromaDocument[] {
    const documents: ChromaDocument[] = [];
    const facts = obs.facts ? JSON.parse(obs.facts) : [];
    const concepts = obs.concepts ? JSON.parse(obs.concepts) : [];
    const files_read = obs.files_read ? JSON.parse(obs.files_read) : [];
    const files_modified = obs.files_modified ? JSON.parse(obs.files_modified) : [];

    const baseMetadata: Record<string, string | number> = {
      sqlite_id: obs.id,
      doc_type: 'observation',
      memory_session_id: obs.memory_session_id,
      project: obs.project,
      created_at_epoch: obs.created_at_epoch,
      type: obs.type || 'discovery',
      title: obs.title || 'Untitled'
    };

    if (obs.subtitle) baseMetadata.subtitle = obs.subtitle;
    if (concepts.length > 0) baseMetadata.concepts = concepts.join(',');
    if (files_read.length > 0) baseMetadata.files_read = files_read.join(',');
    if (files_modified.length > 0) baseMetadata.files_modified = files_modified.join(',');

    if (obs.narrative) {
      documents.push({
        id: `obs_${obs.id}_narrative`,
        document: obs.narrative,
        metadata: { ...baseMetadata, field_type: 'narrative' }
      });
    }

    if (obs.text) {
      documents.push({
        id: `obs_${obs.id}_text`,
        document: obs.text,
        metadata: { ...baseMetadata, field_type: 'text' }
      });
    }

    facts.forEach((fact: string, index: number) => {
      documents.push({
        id: `obs_${obs.id}_fact_${index}`,
        document: fact,
        metadata: { ...baseMetadata, field_type: 'fact', fact_index: index }
      });
    });

    return documents;
  }

  private formatSummaryDocs(summary: StoredSummary): ChromaDocument[] {
    const documents: ChromaDocument[] = [];

    const baseMetadata: Record<string, string | number> = {
      sqlite_id: summary.id,
      doc_type: 'session_summary',
      memory_session_id: summary.memory_session_id,
      project: summary.project,
      created_at_epoch: summary.created_at_epoch,
      prompt_number: summary.prompt_number || 0
    };

    const fields = ['request', 'investigated', 'learned', 'completed', 'next_steps', 'notes'] as const;
    for (const field of fields) {
      if (summary[field]) {
        documents.push({
          id: `summary_${summary.id}_${field}`,
          document: summary[field]!,
          metadata: { ...baseMetadata, field_type: field }
        });
      }
    }

    return documents;
  }

  private formatUserPromptDoc(prompt: StoredUserPrompt): ChromaDocument {
    return {
      id: `prompt_${prompt.id}`,
      document: prompt.prompt_text,
      metadata: {
        sqlite_id: prompt.id,
        doc_type: 'user_prompt',
        memory_session_id: prompt.memory_session_id,
        project: prompt.project,
        created_at_epoch: prompt.created_at_epoch,
        prompt_number: prompt.prompt_number
      }
    };
  }

  private async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) return;

    await this.ensureCollection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      await this.client.callTool({
        name: 'chroma_add_documents',
        arguments: {
          collection_name: this.collectionName,
          documents: documents.map(d => d.document),
          ids: documents.map(d => d.id),
          metadatas: documents.map(d => d.metadata)
        }
      });

      logger.debug('CHROMA', 'Documents added', {
        collection: this.collectionName,
        count: documents.length
      });
    } catch (error) {
      logger.error('CHROMA', 'Failed to add documents', {
        collection: this.collectionName,
        count: documents.length
      }, error as Error);
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
    if (this.disabled) return;

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
    logger.info('CHROMA', 'Syncing observation', {
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
    if (this.disabled) return;

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
    logger.info('CHROMA', 'Syncing summary', {
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
    if (this.disabled) return;

    const stored: StoredUserPrompt = {
      id: promptId,
      content_session_id: '',
      prompt_number: promptNumber,
      prompt_text: promptText,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch,
      memory_session_id: memorySessionId,
      project: project
    };

    const document = this.formatUserPromptDoc(stored);
    logger.info('CHROMA', 'Syncing user prompt', { promptId, project });

    await this.addDocuments([document]);
  }

  async query(
    queryText: string,
    limit: number,
    filters?: VectorFilters
  ): Promise<VectorQueryResult[]> {
    if (this.disabled) return [];

    await this.ensureConnection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    // Build Chroma where filter
    const whereFilter: Record<string, any> = {};
    if (filters?.project) whereFilter.project = filters.project;
    if (filters?.docType) whereFilter.doc_type = filters.docType;
    if (filters?.memorySessionId) whereFilter.memory_session_id = filters.memorySessionId;

    const whereStringified = Object.keys(whereFilter).length > 0 ? JSON.stringify(whereFilter) : undefined;

    let result;
    try {
      result = await this.client.callTool({
        name: 'chroma_query_documents',
        arguments: {
          collection_name: this.collectionName,
          query_texts: [queryText],
          n_results: limit,
          include: ['documents', 'metadatas', 'distances'],
          where: whereStringified
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000');

      if (isConnectionError) {
        this.connected = false;
        this.client = null;
        throw new Error(`Chroma query failed - connection lost: ${errorMessage}`);
      }
      throw error;
    }

    const resultText = result.content[0]?.text || '';
    let parsed: any;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      return [];
    }

    const results: VectorQueryResult[] = [];
    const docIds = parsed.ids?.[0] || [];
    const distances = parsed.distances?.[0] || [];
    const metadatas = parsed.metadatas?.[0] || [];
    const documents = parsed.documents?.[0] || [];

    const seenSqliteIds = new Set<number>();

    for (let i = 0; i < docIds.length; i++) {
      const docId = docIds[i];
      const meta = metadatas[i] || {};
      const sqliteId = meta.sqlite_id;

      if (!sqliteId || seenSqliteIds.has(sqliteId)) continue;
      seenSqliteIds.add(sqliteId);

      results.push({
        id: docId,
        sqliteId,
        docType: meta.doc_type as 'observation' | 'session_summary' | 'user_prompt',
        distance: distances[i] || 0,
        metadata: meta,
        content: documents[i]
      });
    }

    return results;
  }

  /**
   * Legacy query method for backwards compatibility
   * @deprecated Use query() instead - returns VectorQueryResult[]
   */
  async queryChroma(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    if (this.disabled) {
      return { ids: [], distances: [], metadatas: [] };
    }

    await this.ensureConnection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    const whereStringified = whereFilter && Object.keys(whereFilter).length > 0
      ? JSON.stringify(whereFilter)
      : undefined;

    let result;
    try {
      result = await this.client.callTool({
        name: 'chroma_query_documents',
        arguments: {
          collection_name: this.collectionName,
          query_texts: [query],
          n_results: limit,
          include: ['documents', 'metadatas', 'distances'],
          where: whereStringified
        }
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000');

      if (isConnectionError) {
        this.connected = false;
        this.client = null;
        throw new Error(`Chroma query failed - connection lost: ${errorMessage}`);
      }
      throw error;
    }

    const resultText = result.content[0]?.text || '';
    let parsed: any;
    try {
      parsed = JSON.parse(resultText);
    } catch {
      return { ids: [], distances: [], metadatas: [] };
    }

    // Return raw format expected by legacy callers
    const docIds = parsed.ids?.[0] || [];
    const distances = parsed.distances?.[0] || [];
    const metadatas = parsed.metadatas?.[0] || [];

    // Extract sqlite_ids and dedupe
    const ids: number[] = [];
    const deduped: { distance: number; meta: any }[] = [];
    const seenSqliteIds = new Set<number>();

    for (let i = 0; i < metadatas.length; i++) {
      const meta = metadatas[i] || {};
      const sqliteId = meta.sqlite_id;

      if (!sqliteId || seenSqliteIds.has(sqliteId)) continue;
      seenSqliteIds.add(sqliteId);

      ids.push(sqliteId);
      deduped.push({ distance: distances[i] || 0, meta });
    }

    return {
      ids,
      distances: deduped.map(d => d.distance),
      metadatas: deduped.map(d => d.meta)
    };
  }

  private async getExistingChromaIds(): Promise<{
    observations: Set<number>;
    summaries: Set<number>;
    prompts: Set<number>;
  }> {
    await this.ensureConnection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    const observationIds = new Set<number>();
    const summaryIds = new Set<number>();
    const promptIds = new Set<number>();

    let offset = 0;
    const limit = 1000;

    logger.info('CHROMA', 'Fetching existing document IDs...', { project: this.project });

    while (true) {
      try {
        const result = await this.client.callTool({
          name: 'chroma_get_documents',
          arguments: {
            collection_name: this.collectionName,
            limit,
            offset,
            where: { project: this.project },
            include: ['metadatas']
          }
        });

        const data = result.content[0];
        if (data.type !== 'text') break;

        const parsed = JSON.parse(data.text);
        const metadatas = parsed.metadatas || [];

        if (metadatas.length === 0) break;

        for (const meta of metadatas) {
          if (meta.sqlite_id) {
            if (meta.doc_type === 'observation') observationIds.add(meta.sqlite_id);
            else if (meta.doc_type === 'session_summary') summaryIds.add(meta.sqlite_id);
            else if (meta.doc_type === 'user_prompt') promptIds.add(meta.sqlite_id);
          }
        }

        offset += limit;
      } catch (error) {
        logger.error('CHROMA', 'Failed to fetch existing IDs', { project: this.project }, error as Error);
        throw error;
      }
    }

    return { observations: observationIds, summaries: summaryIds, prompts: promptIds };
  }

  async ensureBackfilled(): Promise<void> {
    if (this.disabled) return;

    logger.info('CHROMA', 'Starting smart backfill', { project: this.project });
    await this.ensureCollection();

    const existing = await this.getExistingChromaIds();
    const db = new SessionStore();

    try {
      // Backfill observations
      const existingObsIds = Array.from(existing.observations);
      const obsExclusionClause = existingObsIds.length > 0
        ? `AND id NOT IN (${existingObsIds.join(',')})`
        : '';

      const observations = db.db.prepare(`
        SELECT * FROM observations WHERE project = ? ${obsExclusionClause} ORDER BY id ASC
      `).all(this.project) as StoredObservation[];

      const obsDocs: ChromaDocument[] = [];
      for (const obs of observations) {
        obsDocs.push(...this.formatObservationDocs(obs));
      }

      for (let i = 0; i < obsDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(obsDocs.slice(i, i + this.BATCH_SIZE));
      }

      // Backfill summaries
      const existingSummaryIds = Array.from(existing.summaries);
      const summaryExclusionClause = existingSummaryIds.length > 0
        ? `AND id NOT IN (${existingSummaryIds.join(',')})`
        : '';

      const summaries = db.db.prepare(`
        SELECT * FROM session_summaries WHERE project = ? ${summaryExclusionClause} ORDER BY id ASC
      `).all(this.project) as StoredSummary[];

      const summaryDocs: ChromaDocument[] = [];
      for (const summary of summaries) {
        summaryDocs.push(...this.formatSummaryDocs(summary));
      }

      for (let i = 0; i < summaryDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(summaryDocs.slice(i, i + this.BATCH_SIZE));
      }

      // Backfill prompts
      const existingPromptIds = Array.from(existing.prompts);
      const promptExclusionClause = existingPromptIds.length > 0
        ? `AND up.id NOT IN (${existingPromptIds.join(',')})`
        : '';

      const prompts = db.db.prepare(`
        SELECT up.*, s.project, s.memory_session_id
        FROM user_prompts up
        JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
        WHERE s.project = ? ${promptExclusionClause}
        ORDER BY up.id ASC
      `).all(this.project) as StoredUserPrompt[];

      const promptDocs: ChromaDocument[] = [];
      for (const prompt of prompts) {
        promptDocs.push(this.formatUserPromptDoc(prompt));
      }

      for (let i = 0; i < promptDocs.length; i += this.BATCH_SIZE) {
        await this.addDocuments(promptDocs.slice(i, i + this.BATCH_SIZE));
      }

      logger.info('CHROMA', 'Smart backfill complete', {
        project: this.project,
        synced: {
          observations: obsDocs.length,
          summaries: summaryDocs.length,
          prompts: promptDocs.length
        }
      });
    } finally {
      db.close();
    }
  }

  async getStats(): Promise<VectorStats> {
    if (this.disabled) {
      return {
        backend: this.name,
        documentCount: 0,
        collectionName: this.collectionName
      };
    }

    await this.ensureConnection();

    if (!this.client) {
      throw new Error('Chroma client not initialized');
    }

    try {
      const result = await this.client.callTool({
        name: 'chroma_get_collection_info',
        arguments: { collection_name: this.collectionName }
      });

      const data = result.content[0];
      if (data.type === 'text') {
        const parsed = JSON.parse(data.text);
        return {
          backend: this.name,
          documentCount: parsed.count || 0,
          collectionName: this.collectionName
        };
      }
    } catch (error) {
      logger.error('CHROMA', 'Failed to get stats', { project: this.project }, error as Error);
    }

    return {
      backend: this.name,
      documentCount: 0,
      collectionName: this.collectionName
    };
  }
}
