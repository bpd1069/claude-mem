/**
 * DatabaseManager: Single long-lived database connection
 *
 * Responsibility:
 * - Manage single database connection for worker lifetime
 * - Provide centralized access to SessionStore and SessionSearch
 * - High-level database operations
 * - Vector backend integration (ChromaDB or sqlite-vec)
 */

import { SessionStore } from '../sqlite/SessionStore.js';
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { ChromaSync } from '../sync/ChromaSync.js';
import type { VectorBackend } from '../vector/VectorBackend.js';
import { ChromaBackend } from '../vector/ChromaBackend.js';
import { SqliteVecBackend } from '../vector/SqliteVecBackend.js';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import type { DBSession } from '../worker-types.js';

export class DatabaseManager {
  private sessionStore: SessionStore | null = null;
  private sessionSearch: SessionSearch | null = null;
  private vectorBackend: VectorBackend | null = null;

  /**
   * Initialize database connection (once, stays open)
   */
  async initialize(): Promise<void> {
    // Open database connection (ONCE)
    this.sessionStore = new SessionStore();
    this.sessionSearch = new SessionSearch();

    // Initialize vector backend based on settings
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const backendType = (settings as any).VECTOR_BACKEND || 'chroma';

    if (backendType === 'chroma') {
      this.vectorBackend = new ChromaBackend('claude-mem');
    } else if (backendType === 'sqlite-vec') {
      this.vectorBackend = new SqliteVecBackend('claude-mem');
    } else if (backendType === 'none') {
      this.vectorBackend = null;
      logger.info('DB', 'Vector backend disabled');
    } else {
      logger.warn('DB', `Unknown vector backend: ${backendType}, using chroma`);
      this.vectorBackend = new ChromaBackend('claude-mem');
    }

    if (this.vectorBackend) {
      await this.vectorBackend.initialize();
    }

    logger.info('DB', 'Database initialized', { vectorBackend: backendType });
  }

  /**
   * Close database connection and cleanup all resources
   */
  async close(): Promise<void> {
    // Close vector backend first (terminates any subprocesses)
    if (this.vectorBackend) {
      await this.vectorBackend.close();
      this.vectorBackend = null;
    }

    if (this.sessionStore) {
      this.sessionStore.close();
      this.sessionStore = null;
    }
    if (this.sessionSearch) {
      this.sessionSearch.close();
      this.sessionSearch = null;
    }
    logger.info('DB', 'Database closed');
  }

  /**
   * Get SessionStore instance (throws if not initialized)
   */
  getSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('Database not initialized');
    }
    return this.sessionStore;
  }

  /**
   * Get SessionSearch instance (throws if not initialized)
   */
  getSessionSearch(): SessionSearch {
    if (!this.sessionSearch) {
      throw new Error('Database not initialized');
    }
    return this.sessionSearch;
  }

  /**
   * Get vector backend instance (throws if not initialized)
   */
  getVectorBackend(): VectorBackend {
    if (!this.vectorBackend) {
      throw new Error('Vector backend not initialized or disabled');
    }
    return this.vectorBackend;
  }

  /**
   * Get ChromaSync instance (backwards compatibility)
   * @deprecated Use getVectorBackend() instead
   */
  getChromaSync(): ChromaSync {
    if (!this.vectorBackend) {
      throw new Error('Vector backend not initialized');
    }
    // Cast to ChromaSync for backwards compatibility
    return this.vectorBackend as unknown as ChromaSync;
  }

  // REMOVED: cleanupOrphanedSessions - violates "EVERYTHING SHOULD SAVE ALWAYS"
  // Worker restarts don't make sessions orphaned. Sessions are managed by hooks
  // and exist independently of worker state.

  /**
   * Get session by ID (throws if not found)
   */
  getSessionById(sessionDbId: number): {
    id: number;
    content_session_id: string;
    memory_session_id: string | null;
    project: string;
    user_prompt: string;
  } {
    const session = this.getSessionStore().getSessionById(sessionDbId);
    if (!session) {
      throw new Error(`Session ${sessionDbId} not found`);
    }
    return session;
  }

}
