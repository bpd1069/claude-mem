/**
 * ChromaSync - Re-export for backwards compatibility
 *
 * @deprecated Use ChromaBackend from '../vector/ChromaBackend.js' instead
 *
 * This file re-exports ChromaBackend as ChromaSync for backwards compatibility.
 * The implementation has moved to the vector/ directory as part of the
 * VectorBackend abstraction refactoring.
 */

export { ChromaBackend as ChromaSync } from '../vector/ChromaBackend.js';
