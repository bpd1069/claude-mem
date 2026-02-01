/**
 * Vector Backend Module
 *
 * Provides abstraction for vector storage backends.
 * Supports multiple implementations: ChromaDB, sqlite-vec
 */

export * from './VectorBackend.js';
export * from './ChromaBackend.js';
export * from './SqliteVecBackend.js';
export * from './EmbeddingProvider.js';
