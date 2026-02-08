import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { ObserverRegistry } from '../../src/services/infrastructure/ObserverRegistry.js';

describe('Shutdown with Observers', () => {
  let registry: ObserverRegistry;
  const spawnedPids: number[] = [];

  beforeEach(() => {
    registry = ObserverRegistry.getInstance();
    registry.reset();
  });

  afterEach(() => {
    for (const pid of spawnedPids) {
      try { process.kill(pid, 'SIGKILL'); } catch {}
    }
    spawnedPids.length = 0;
  });

  it('should kill all registered observers across sessions', async () => {
    const child1 = spawn('sleep', ['60'], { stdio: 'ignore' });
    const child2 = spawn('sleep', ['60'], { stdio: 'ignore' });
    const child3 = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child1.pid!, child2.pid!, child3.pid!);

    registry.registerObservers(1, [child1.pid!]);
    registry.registerObservers(2, [child2.pid!, child3.pid!]);

    await registry.killAll();

    // All should be dead
    await new Promise(r => setTimeout(r, 500));
    for (const pid of [child1.pid!, child2.pid!, child3.pid!]) {
      expect(() => process.kill(pid, 0)).toThrow();
    }

    expect(registry.getSessionCount()).toBe(0);
    expect(registry.getAllPids()).toEqual([]);
  });

  it('should handle killAll with zero observers', async () => {
    await registry.killAll();
    // Should not throw
    expect(registry.getSessionCount()).toBe(0);
  });

  it('should handle killAll with mix of alive and dead PIDs', async () => {
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child.pid!);

    registry.registerObservers(1, [child.pid!, 999999]); // one alive, one dead

    await registry.killAll();

    await new Promise(r => setTimeout(r, 500));
    expect(() => process.kill(child.pid!, 0)).toThrow();
    expect(registry.getSessionCount()).toBe(0);
  });
});
