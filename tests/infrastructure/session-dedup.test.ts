import { describe, it, expect } from 'bun:test';

/**
 * Session dedup guard tests
 *
 * These test the generatorPromise guard logic. Since SessionRoutes and
 * WorkerService are tightly coupled to Express/HTTP, we test the guard
 * logic in isolation using a mock session object.
 */

interface MockSession {
  sessionDbId: number;
  generatorPromise: Promise<void> | null;
  currentProvider: string | null;
  spawnCount: number;
}

function createMockSession(): MockSession {
  return {
    sessionDbId: 1,
    generatorPromise: null,
    currentProvider: null,
    spawnCount: 0
  };
}

/**
 * Simulates the dedup guard from startGeneratorWithProvider
 */
function startGeneratorWithGuard(session: MockSession): boolean {
  if (session.generatorPromise) {
    return false; // blocked by guard
  }

  session.spawnCount++;
  session.currentProvider = 'claude';
  session.generatorPromise = new Promise<void>(resolve => {
    setTimeout(resolve, 100);
  }).finally(() => {
    session.generatorPromise = null;
    session.currentProvider = null;
  });

  return true; // spawned
}

describe('Session Dedup Guard', () => {
  it('should allow first spawn', () => {
    const session = createMockSession();
    const result = startGeneratorWithGuard(session);
    expect(result).toBe(true);
    expect(session.spawnCount).toBe(1);
  });

  it('should block second spawn while first is running', () => {
    const session = createMockSession();
    startGeneratorWithGuard(session);
    const result = startGeneratorWithGuard(session);
    expect(result).toBe(false);
    expect(session.spawnCount).toBe(1);
  });

  it('should allow respawn after generator completes', async () => {
    const session = createMockSession();
    startGeneratorWithGuard(session);

    // Wait for completion
    await session.generatorPromise;
    await new Promise(r => setTimeout(r, 10));

    const result = startGeneratorWithGuard(session);
    expect(result).toBe(true);
    expect(session.spawnCount).toBe(2);
  });

  it('should block many concurrent attempts', () => {
    const session = createMockSession();
    startGeneratorWithGuard(session);

    for (let i = 0; i < 100; i++) {
      startGeneratorWithGuard(session);
    }

    expect(session.spawnCount).toBe(1);
  });
});
