import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { ObserverRegistry } from '../../src/services/infrastructure/ObserverRegistry.js';
import { ObserverReaper } from '../../src/services/infrastructure/ObserverReaper.js';

describe('ObserverReaper', () => {
  let registry: ObserverRegistry;
  let reaper: ObserverReaper;
  const spawnedPids: number[] = [];

  beforeEach(() => {
    registry = ObserverRegistry.getInstance();
    registry.reset();
    reaper = new ObserverReaper();
  });

  afterEach(() => {
    reaper.stop();
    for (const pid of spawnedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    spawnedPids.length = 0;
  });

  it('should start and stop without errors', () => {
    reaper.start();
    reaper.stop();
    // Double stop should be safe
    reaper.stop();
  });

  it('should not start twice', () => {
    reaper.start();
    reaper.start(); // Should be no-op
    reaper.stop();
  });

  it('should prune dead PIDs from registry', async () => {
    registry.registerObservers(1, [999999, 999998]);
    const result = await reaper.reap();
    expect(result.pruned).toBe(2);
    expect(registry.getAllPids()).toEqual([]);
  });

  it('should not kill registered living processes', async () => {
    // Register our own PID (alive)
    registry.registerObservers(1, [process.pid]);
    const result = await reaper.reap();
    expect(result.pruned).toBe(0);
    expect(registry.getAllPids()).toContain(process.pid);
  });

  it('should report zero when nothing to clean', async () => {
    const result = await reaper.reap();
    expect(result.pruned).toBe(0);
    expect(result.killed).toBe(0);
  });
});
