import { describe, it, expect } from 'bun:test';

/**
 * Tests that the abort controller is replaced after natural completion,
 * preventing the bug where a new generator inherits an already-aborted signal.
 */

interface MockSession {
  sessionDbId: number;
  generatorPromise: Promise<void> | null;
  abortController: AbortController;
  currentProvider: string | null;
  spawnCount: number;
}

function createMockSession(): MockSession {
  return {
    sessionDbId: 1,
    generatorPromise: null,
    abortController: new AbortController(),
    currentProvider: null,
    spawnCount: 0
  };
}

/**
 * Simulates startGeneratorWithProvider with the .finally() handler
 * that mirrors the real code in SessionRoutes.ts
 */
function startGenerator(session: MockSession, hasPendingWork: boolean): void {
  if (!session.generatorPromise) {
    session.spawnCount++;
    session.currentProvider = 'claude';

    session.generatorPromise = new Promise<void>(resolve => {
      // Check if already aborted (the bug we're testing)
      if (session.abortController.signal.aborted) {
        resolve(); // exits immediately
        return;
      }
      setTimeout(resolve, 50); // simulate work
    }).finally(() => {
      const wasAborted = session.abortController.signal.aborted;
      session.generatorPromise = null;
      session.currentProvider = null;

      if (!wasAborted) {
        if (!hasPendingWork) {
          // Natural completion: abort old, create fresh (THE FIX)
          session.abortController.abort();
          session.abortController = new AbortController();
        }
      }
    });
  }
}

describe('AbortController Reuse Bug', () => {
  it('should have a non-aborted controller after natural completion', async () => {
    const session = createMockSession();

    // Start and complete generator with no pending work
    startGenerator(session, false);
    await session.generatorPromise;
    await new Promise(r => setTimeout(r, 10));

    // The controller should be fresh (not aborted)
    expect(session.abortController.signal.aborted).toBe(false);
  });

  it('should allow new generator to run after natural completion', async () => {
    const session = createMockSession();

    // First generator
    startGenerator(session, false);
    await session.generatorPromise;
    await new Promise(r => setTimeout(r, 10));

    // Second generator should work
    let secondRanFully = false;
    session.generatorPromise = null;
    session.spawnCount = 0;

    session.generatorPromise = new Promise<void>(resolve => {
      if (session.abortController.signal.aborted) {
        resolve();
        return;
      }
      secondRanFully = true;
      setTimeout(resolve, 50);
    });

    await session.generatorPromise;
    expect(secondRanFully).toBe(true);
  });

  it('should demonstrate the bug WITHOUT the fix', async () => {
    const session = createMockSession();

    // Simulate OLD behavior (abort without replacement)
    session.generatorPromise = new Promise<void>(resolve => {
      setTimeout(resolve, 50);
    }).finally(() => {
      session.generatorPromise = null;
      // OLD CODE: abort but don't replace
      session.abortController.abort();
    });

    await session.generatorPromise;
    await new Promise(r => setTimeout(r, 10));

    // Now the controller is poisoned
    expect(session.abortController.signal.aborted).toBe(true);

    // New generator would see aborted signal immediately
    let ranFully = false;
    if (!session.abortController.signal.aborted) {
      ranFully = true;
    }
    expect(ranFully).toBe(false);
  });
});
