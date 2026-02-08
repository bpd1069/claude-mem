import { describe, it, expect } from 'bun:test';

/**
 * Rapid observation stress test
 *
 * Validates that the dedup guard prevents spawning multiple generators
 * even under high-concurrency conditions. Tests the guard logic in
 * isolation since the actual HTTP layer requires full server setup.
 */

interface MockSession {
  sessionDbId: number;
  generatorPromise: Promise<void> | null;
  spawnCount: number;
}

function ensureGeneratorRunning(session: MockSession): void {
  // This mirrors the guard logic in SessionRoutes.ensureGeneratorRunning
  if (session.generatorPromise) return;

  session.spawnCount++;
  session.generatorPromise = new Promise<void>(resolve => {
    // Simulate generator running for 50ms
    setTimeout(resolve, 50);
  }).finally(() => {
    session.generatorPromise = null;
  });
}

describe('Rapid Observation Stress', () => {
  it('should spawn max 1 generator for 100 concurrent observations', () => {
    const session: MockSession = {
      sessionDbId: 1,
      generatorPromise: null,
      spawnCount: 0
    };

    // Simulate 100 rapid observations
    for (let i = 0; i < 100; i++) {
      ensureGeneratorRunning(session);
    }

    expect(session.spawnCount).toBe(1);
  });

  it('should allow respawn after generator completes', async () => {
    const session: MockSession = {
      sessionDbId: 1,
      generatorPromise: null,
      spawnCount: 0
    };

    // First batch
    for (let i = 0; i < 50; i++) {
      ensureGeneratorRunning(session);
    }
    expect(session.spawnCount).toBe(1);

    // Wait for completion
    await session.generatorPromise;
    await new Promise(r => setTimeout(r, 10));

    // Second batch
    for (let i = 0; i < 50; i++) {
      ensureGeneratorRunning(session);
    }
    expect(session.spawnCount).toBe(2);
  });

  it('should handle multiple sessions independently', () => {
    const sessions: MockSession[] = Array.from({ length: 5 }, (_, i) => ({
      sessionDbId: i + 1,
      generatorPromise: null,
      spawnCount: 0
    }));

    // Each session gets 20 observations
    for (let i = 0; i < 100; i++) {
      const session = sessions[i % 5];
      ensureGeneratorRunning(session);
    }

    // Each session should have exactly 1 spawn
    for (const session of sessions) {
      expect(session.spawnCount).toBe(1);
    }
  });
});
