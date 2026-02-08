/**
 * ObserverReaper - Periodic cleanup of orphaned SDK observer processes
 *
 * Runs on a 60s interval to:
 * 1. Find observer-like processes via command-line pattern
 * 2. Kill any not tracked in ObserverRegistry (orphans)
 * 3. Prune dead PIDs from registry
 */

import { logger } from '../../utils/logger.js';
import { ObserverRegistry } from './ObserverRegistry.js';

const REAPER_INTERVAL_MS = 60_000;

export class ObserverReaper {
  private interval: ReturnType<typeof setInterval> | null = null;
  private registry: ObserverRegistry;

  constructor() {
    this.registry = ObserverRegistry.getInstance();
  }

  /**
   * Start the periodic reaper
   */
  start(): void {
    if (this.interval) return;

    this.interval = setInterval(() => {
      this.reap().catch(error => {
        logger.debug('REAPER', 'Reap cycle failed', {}, error as Error);
      });
    }, REAPER_INTERVAL_MS);

    logger.info('REAPER', 'Observer reaper started', { intervalMs: REAPER_INTERVAL_MS });
  }

  /**
   * Stop the reaper
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('REAPER', 'Observer reaper stopped');
    }
  }

  /**
   * Run one reap cycle
   */
  async reap(): Promise<{ pruned: number; killed: number }> {
    // Prune dead PIDs from registry
    const pruned = this.registry.pruneDeadPids();

    // Find unregistered observer processes
    const orphanPids = await this.registry.findUnregisteredObservers();
    let killed = 0;

    for (const pid of orphanPids) {
      try {
        process.kill(pid, 'SIGTERM');
        killed++;
        logger.info('REAPER', 'Killed orphaned observer', { pid });
      } catch {
        // Already dead
      }
    }

    if (pruned > 0 || killed > 0) {
      logger.info('REAPER', 'Reap cycle complete', {
        pruned,
        killed,
        registeredSessions: this.registry.getSessionCount(),
        registeredPids: this.registry.getAllPids().length
      });
    }

    return { pruned, killed };
  }
}
