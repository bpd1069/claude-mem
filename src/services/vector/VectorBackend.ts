/**
 * VectorBackend Interface
 *
 * Abstraction layer for vector storage backends.
 * Implementations: ChromaBackend (MCP-based), SqliteVecBackend (local)
 */

import type { ParsedObservation, ParsedSummary } from '../../sdk/parser.js';

/**
 * A document to be stored in the vector database
 */
export interface VectorDocument {
  id: string;
  content: string;
  metadata: Record<string, string | number>;
  embedding?: number[]; // Optional pre-computed embedding
}

/**
 * Result from a vector query
 */
export interface VectorQueryResult {
  id: string;
  sqliteId: number;
  docType: 'observation' | 'session_summary' | 'user_prompt';
  distance: number;
  metadata: Record<string, string | number>;
  content?: string;
}

/**
 * Filters for vector queries
 */
export interface VectorFilters {
  project?: string;
  docType?: 'observation' | 'session_summary' | 'user_prompt';
  memorySessionId?: string;
  minEpoch?: number;
  maxEpoch?: number;
}

/**
 * Statistics about the vector backend
 */
export interface VectorStats {
  backend: string;
  documentCount: number;
  collectionName: string;
  dimensions?: number;
  lastSync?: number;
}

/**
 * Abstract interface for vector storage backends
 *
 * All implementations must provide:
 * - Document storage (observations, summaries, prompts)
 * - Semantic query capability
 * - Backfill from SQLite
 */
export interface VectorBackend {
  /** Backend identifier */
  readonly name: string;

  /** Check if backend is disabled (e.g., Windows for Chroma) */
  isDisabled(): boolean;

  /**
   * Initialize the backend connection
   * May be lazy (connect on first use) or eager
   */
  initialize(): Promise<void>;

  /**
   * Close the backend connection and cleanup resources
   */
  close(): Promise<void>;

  /**
   * Sync a single observation to the vector store
   */
  syncObservation(
    observationId: number,
    memorySessionId: string,
    project: string,
    observation: ParsedObservation,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens?: number
  ): Promise<void>;

  /**
   * Sync a single summary to the vector store
   */
  syncSummary(
    summaryId: number,
    memorySessionId: string,
    project: string,
    summary: ParsedSummary,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens?: number
  ): Promise<void>;

  /**
   * Sync a single user prompt to the vector store
   */
  syncUserPrompt(
    promptId: number,
    memorySessionId: string,
    project: string,
    promptText: string,
    promptNumber: number,
    createdAtEpoch: number
  ): Promise<void>;

  /**
   * Query the vector store for semantically similar documents
   */
  query(
    queryText: string,
    limit: number,
    filters?: VectorFilters
  ): Promise<VectorQueryResult[]>;

  /**
   * Backfill: Sync all SQLite data missing from vector store
   */
  ensureBackfilled(): Promise<void>;

  /**
   * Get statistics about the vector store
   */
  getStats(): Promise<VectorStats>;

  /**
   * Delete documents by their IDs
   */
  deleteDocuments?(ids: string[]): Promise<void>;

  /**
   * Future: Attach a remote database for federated queries
   * 
   * "Resurrection Ship" model: Separate vector repos can be attached
   * to enable cross-team, cross-project knowledge sharing.
   * Each attached database acts as an extension of the local memory.
   */
  attachRemote?(path: string): Promise<void>;

  /**
   * Future: Query across multiple attached databases
   * 
   * Enables searching across team members' knowledge bases,
   * shared project memories, or historical archives.
   */
  queryFederated?(
    queryText: string,
    limit: number,
    sources: string[]
  ): Promise<VectorQueryResult[]>;
}

/**
 * Factory type for creating vector backends
 */
export type VectorBackendFactory = (project: string) => VectorBackend;
