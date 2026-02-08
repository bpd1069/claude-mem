import { describe, it, expect, beforeEach } from 'bun:test';
import { ObserverRegistry } from '../../src/services/infrastructure/ObserverRegistry.js';

describe('ObserverRegistry', () => {
  let registry: ObserverRegistry;

  beforeEach(() => {
    registry = ObserverRegistry.getInstance();
    registry.reset();
  });

  it('should be a singleton', () => {
    const a = ObserverRegistry.getInstance();
    const b = ObserverRegistry.getInstance();
    expect(a).toBe(b);
  });

  it('should register PIDs for a session', () => {
    registry.registerObservers(1, [100, 200]);
    expect(registry.getAllPids()).toEqual([100, 200]);
  });

  it('should track PIDs per session', () => {
    registry.registerObservers(1, [100]);
    registry.registerObservers(2, [200]);
    expect(registry.getAllPids().sort()).toEqual([100, 200]);
    expect(registry.getSessionCount()).toBe(2);
  });

  it('should deduplicate PIDs within a session', () => {
    registry.registerObservers(1, [100, 200]);
    registry.registerObservers(1, [200, 300]);
    expect(registry.getAllPids().sort()).toEqual([100, 200, 300]);
  });

  it('should handle empty PID array', () => {
    registry.registerObservers(1, []);
    expect(registry.getAllPids()).toEqual([]);
    expect(registry.getSessionCount()).toBe(0);
  });

  it('should prune dead PIDs', () => {
    // Register PIDs that don't exist
    registry.registerObservers(1, [999999, 999998]);
    const pruned = registry.pruneDeadPids();
    expect(pruned).toBe(2);
    expect(registry.getAllPids()).toEqual([]);
    expect(registry.getSessionCount()).toBe(0);
  });

  it('should reset all state', () => {
    registry.registerObservers(1, [100]);
    registry.registerObservers(2, [200]);
    registry.reset();
    expect(registry.getAllPids()).toEqual([]);
    expect(registry.getSessionCount()).toBe(0);
  });

  it('should keep alive PIDs during prune', () => {
    // Our own PID is alive
    registry.registerObservers(1, [process.pid]);
    const pruned = registry.pruneDeadPids();
    expect(pruned).toBe(0);
    expect(registry.getAllPids()).toEqual([process.pid]);
  });
});
