import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { spawn } from 'child_process';
import { ObserverRegistry } from '../../src/services/infrastructure/ObserverRegistry.js';

describe('killSessionObservers', () => {
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

  it('should kill registered sleep processes', async () => {
    const child1 = spawn('sleep', ['60'], { stdio: 'ignore' });
    const child2 = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child1.pid!, child2.pid!);

    registry.registerObservers(1, [child1.pid!, child2.pid!]);

    await registry.killSessionObservers(1);

    // Verify processes are dead
    await new Promise(r => setTimeout(r, 500));
    for (const pid of [child1.pid!, child2.pid!]) {
      expect(() => process.kill(pid, 0)).toThrow();
    }
  });

  it('should handle already-dead PIDs gracefully', async () => {
    registry.registerObservers(1, [999999]);
    // Should not throw
    await registry.killSessionObservers(1);
    expect(registry.getAllPids()).toEqual([]);
  });

  it('should clean up registry after kill', async () => {
    const child = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child.pid!);

    registry.registerObservers(1, [child.pid!]);
    await registry.killSessionObservers(1);

    expect(registry.getSessionCount()).toBe(0);
    expect(registry.getAllPids()).toEqual([]);
  });

  it('should only kill observers for the specified session', async () => {
    const child1 = spawn('sleep', ['60'], { stdio: 'ignore' });
    const child2 = spawn('sleep', ['60'], { stdio: 'ignore' });
    spawnedPids.push(child1.pid!, child2.pid!);

    registry.registerObservers(1, [child1.pid!]);
    registry.registerObservers(2, [child2.pid!]);

    await registry.killSessionObservers(1);

    // Session 1's process should be dead
    await new Promise(r => setTimeout(r, 500));
    expect(() => process.kill(child1.pid!, 0)).toThrow();

    // Session 2's process should still be alive
    expect(() => process.kill(child2.pid!, 0)).not.toThrow();
  });

  it('should handle empty session gracefully', async () => {
    await registry.killSessionObservers(999);
    // Should not throw
  });
});
