/**
 * ObserverRegistry - Tracks SDK observer subprocess PIDs per session
 *
 * Singleton that maps sessionDbId → Set<pid> for lifecycle management.
 * Prevents process accumulation by enabling:
 * - Session-scoped cleanup (kill observers when session ends)
 * - Orphan detection (cross-reference with live process table)
 * - Graceful shutdown (kill all tracked observers)
 */

import { logger } from '../../utils/logger.js';
import { getChildProcesses, findOrphanedObserverProcesses } from './ProcessManager.js';

export class ObserverRegistry {
  private static instance: ObserverRegistry;
  private registry: Map<number, Set<number>> = new Map();

  private constructor() {}

  static getInstance(): ObserverRegistry {
    if (!ObserverRegistry.instance) {
      ObserverRegistry.instance = new ObserverRegistry();
    }
    return ObserverRegistry.instance;
  }

  /**
   * Snapshot current child PIDs (for before/after diffing around query() calls)
   */
  async snapshotChildPids(): Promise<Set<number>> {
    const pids = await getChildProcesses(process.pid);
    return new Set(pids);
  }

  /**
   * Register observer PIDs for a session
   */
  registerObservers(sessionDbId: number, pids: number[]): void {
    if (pids.length === 0) return;

    let sessionPids = this.registry.get(sessionDbId);
    if (!sessionPids) {
      sessionPids = new Set();
      this.registry.set(sessionDbId, sessionPids);
    }

    for (const pid of pids) {
      sessionPids.add(pid);
    }

    logger.info('REGISTRY', 'Registered observer PIDs', {
      sessionDbId,
      newPids: pids,
      totalForSession: sessionPids.size
    });
  }

  /**
   * Kill all observer processes for a session
   * SIGTERM first, wait up to 3s, then SIGKILL survivors
   */
  async killSessionObservers(sessionDbId: number): Promise<void> {
    const pids = this.registry.get(sessionDbId);
    if (!pids || pids.size === 0) return;

    const pidArray = Array.from(pids);
    logger.info('REGISTRY', 'Killing session observers', {
      sessionDbId,
      pids: pidArray
    });

    // SIGTERM first
    for (const pid of pidArray) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Already dead
        pids.delete(pid);
      }
    }

    // Wait up to 3s for graceful exit
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const alive = pidArray.filter(pid => {
        try { process.kill(pid, 0); return true; } catch { return false; }
      });
      if (alive.length === 0) break;
      await new Promise(r => setTimeout(r, 200));
    }

    // SIGKILL survivors
    for (const pid of pidArray) {
      try {
        process.kill(pid, 0); // check alive
        process.kill(pid, 'SIGKILL');
        logger.debug('REGISTRY', 'Force-killed observer', { pid, sessionDbId });
      } catch {
        // Already dead
      }
    }

    this.registry.delete(sessionDbId);
  }

  /**
   * Kill all tracked observers (shutdown helper)
   */
  async killAll(): Promise<void> {
    const sessionIds = Array.from(this.registry.keys());
    if (sessionIds.length === 0) return;

    logger.info('REGISTRY', 'Killing all observers', {
      sessions: sessionIds.length,
      totalPids: this.getAllPids().length
    });

    await Promise.all(sessionIds.map(id => this.killSessionObservers(id)));
  }

  /**
   * Get all tracked PIDs across all sessions
   */
  getAllPids(): number[] {
    const all: number[] = [];
    for (const pids of this.registry.values()) {
      all.push(...pids);
    }
    return all;
  }

  /**
   * Find observer processes via command-line pattern (fallback discovery)
   * Returns PIDs not tracked in the registry
   */
  async findUnregisteredObservers(): Promise<number[]> {
    const discoveredPids = await findOrphanedObserverProcesses();
    const registeredPids = new Set(this.getAllPids());
    return discoveredPids.filter(pid => !registeredPids.has(pid));
  }

  /**
   * Prune dead PIDs from registry
   */
  pruneDeadPids(): number {
    let pruned = 0;
    for (const [sessionDbId, pids] of this.registry.entries()) {
      for (const pid of Array.from(pids)) {
        try {
          process.kill(pid, 0); // check alive
        } catch {
          pids.delete(pid);
          pruned++;
        }
      }
      if (pids.size === 0) {
        this.registry.delete(sessionDbId);
      }
    }
    return pruned;
  }

  /**
   * Reset for test isolation
   */
  reset(): void {
    this.registry.clear();
  }

  /**
   * Get session count (for diagnostics)
   */
  getSessionCount(): number {
    return this.registry.size;
  }
}
