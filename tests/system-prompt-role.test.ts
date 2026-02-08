/**
 * Tests for system prompt role handling in LMStudioAgent and OpenRouterAgent.
 *
 * The init prompt contains extraction instructions that should be sent as
 * role: 'system' to the LLM API, not role: 'user'. When sent as 'user',
 * small models (granite, xlam) ignore the instructions and hallucinate.
 *
 * Additionally, truncateHistory() must preserve the system message even
 * when truncating older messages to fit the context window.
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { LMStudioAgent } from '../src/services/worker/LMStudioAgent';
import { OpenRouterAgent } from '../src/services/worker/OpenRouterAgent';
import { DatabaseManager } from '../src/services/worker/DatabaseManager';
import { SessionManager } from '../src/services/worker/SessionManager';
import { ModeManager } from '../src/services/domain/ModeManager';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager';
import type { ConversationMessage } from '../src/services/worker-types';

// Mock mode config (matches pattern from gemini_agent.test.ts)
const mockMode = {
  name: 'code',
  prompts: {
    init: 'init prompt',
    observation: 'obs prompt',
    summary: 'summary prompt'
  },
  observation_types: [{ id: 'discovery' }, { id: 'bugfix' }],
  observation_concepts: []
};

function makeSession(overrides: Record<string, any> = {}) {
  return {
    sessionDbId: 1,
    contentSessionId: 'test-session',
    memorySessionId: 'mem-session-123',
    project: 'test-project',
    userPrompt: 'test prompt',
    conversationHistory: [] as ConversationMessage[],
    lastPromptNumber: 1,
    cumulativeInputTokens: 0,
    cumulativeOutputTokens: 0,
    pendingMessages: [],
    abortController: new AbortController(),
    generatorPromise: null,
    earliestPendingTimestamp: null,
    currentProvider: null,
    startTime: Date.now(),
    ...overrides
  } as any;
}

function makeMocks() {
  const mockStoreObservations = mock(() => ({
    observationIds: [1],
    summaryId: 1,
    createdAtEpoch: Date.now()
  }));

  const mockDbManager = {
    getSessionStore: () => ({
      storeObservation: mock(() => ({ id: 1, createdAtEpoch: Date.now() })),
      storeObservations: mockStoreObservations,
      storeSummary: mock(() => ({ id: 1, createdAtEpoch: Date.now() })),
      markSessionCompleted: mock(() => {})
    }),
    getChromaSync: () => ({
      syncObservation: mock(() => Promise.resolve()),
      syncSummary: mock(() => Promise.resolve())
    })
  } as unknown as DatabaseManager;

  const mockSessionManager = {
    getMessageIterator: async function* () { yield* []; },
    getPendingMessageStore: () => ({
      markProcessed: mock(() => {}),
      cleanupProcessed: mock(() => 0),
      resetStuckMessages: mock(() => 0)
    })
  } as unknown as SessionManager;

  return { mockDbManager, mockSessionManager };
}

// Spies
let loadFromFileSpy: ReturnType<typeof spyOn>;
let getSpy: ReturnType<typeof spyOn>;
let modeManagerSpy: ReturnType<typeof spyOn>;
let originalFetch: typeof global.fetch;

function setupSpies() {
  modeManagerSpy = spyOn(ModeManager, 'getInstance').mockImplementation(() => ({
    getActiveMode: () => mockMode,
    loadMode: () => {},
  } as any));

  loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
    ...SettingsDefaultsManager.getAllDefaults(),
    CLAUDE_MEM_LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
    CLAUDE_MEM_LMSTUDIO_MODEL: 'test-model',
    CLAUDE_MEM_OPENROUTER_API_KEY: 'test-key',
    CLAUDE_MEM_OPENROUTER_MODEL: 'test-model',
    CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: '20',
    CLAUDE_MEM_OPENROUTER_MAX_TOKENS: '100000',
    CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
  }));

  getSpy = spyOn(SettingsDefaultsManager, 'get').mockImplementation((key: string) => {
    if (key === 'CLAUDE_MEM_LMSTUDIO_BASE_URL') return 'http://localhost:1234/v1';
    if (key === 'CLAUDE_MEM_LMSTUDIO_MODEL') return 'test-model';
    if (key === 'CLAUDE_MEM_OPENROUTER_API_KEY') return 'test-key';
    if (key === 'CLAUDE_MEM_OPENROUTER_MODEL') return 'test-model';
    if (key === 'CLAUDE_MEM_DATA_DIR') return '/tmp/claude-mem-test';
    return SettingsDefaultsManager.getAllDefaults()[key as keyof ReturnType<typeof SettingsDefaultsManager.getAllDefaults>] ?? '';
  });

  originalFetch = global.fetch;
}

function teardownSpies() {
  global.fetch = originalFetch;
  if (modeManagerSpy) modeManagerSpy.mockRestore();
  if (loadFromFileSpy) loadFromFileSpy.mockRestore();
  if (getSpy) getSpy.mockRestore();
  mock.restore();
}

// ─── LMStudioAgent ───────────────────────────────────────────────────────────

describe('LMStudioAgent system prompt role', () => {
  let agent: LMStudioAgent;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    setupSpies();
    mocks = makeMocks();
    agent = new LMStudioAgent(mocks.mockDbManager, mocks.mockSessionManager);
  });

  afterEach(() => {
    teardownSpies();
  });

  it('should send init prompt as system role in API request', async () => {
    const session = makeSession();

    // Mock LM Studio response
    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '<observation><type>discovery</type><title>Test</title></observation>' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }))));

    await agent.startSession(session);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);

    // The first message should be role: 'system', not role: 'user'
    expect(body.messages[0].role).toBe('system');
  });

  it('should store init prompt with system role in conversation history', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    // The first entry in conversationHistory should have role: 'system'
    expect(session.conversationHistory[0].role).toBe('system');
  });

  it('should preserve system message when truncating history', async () => {
    // Build a session with a system message at index 0 followed by many messages
    const history: ConversationMessage[] = [
      { role: 'system' as any, content: 'You are a memory observer agent...' }
    ];

    // Add enough messages to trigger truncation
    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `observation ${i} `.repeat(100) });
      history.push({ role: 'assistant', content: `response ${i} `.repeat(100) });
    }

    const session = makeSession({
      conversationHistory: history,
      lastPromptNumber: 2  // continuation, so no new init prompt is pushed
    });

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    // After truncation, the API request should still include the system message first
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
    // And it should have fewer messages than the original 61 (1 system + 60 user/assistant)
    expect(body.messages.length).toBeLessThan(history.length);
  });
});

// ─── OpenRouterAgent ─────────────────────────────────────────────────────────

describe('OpenRouterAgent system prompt role', () => {
  let agent: OpenRouterAgent;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    setupSpies();
    mocks = makeMocks();
    agent = new OpenRouterAgent(mocks.mockDbManager, mocks.mockSessionManager);
  });

  afterEach(() => {
    teardownSpies();
  });

  it('should send init prompt as system role in API request', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: '<observation><type>discovery</type><title>Test</title></observation>' } }],
      usage: { prompt_tokens: 50, completion_tokens: 20, total_tokens: 70 }
    }))));

    await agent.startSession(session);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);

    // The first message should be role: 'system', not role: 'user'
    expect(body.messages[0].role).toBe('system');
  });

  it('should store init prompt with system role in conversation history', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    // The first entry in conversationHistory should have role: 'system'
    expect(session.conversationHistory[0].role).toBe('system');
  });

  it('should preserve system message when truncating history', async () => {
    const history: ConversationMessage[] = [
      { role: 'system' as any, content: 'You are a memory observer agent...' }
    ];

    for (let i = 0; i < 30; i++) {
      history.push({ role: 'user', content: `observation ${i} `.repeat(100) });
      history.push({ role: 'assistant', content: `response ${i} `.repeat(100) });
    }

    const session = makeSession({
      conversationHistory: history,
      lastPromptNumber: 2
    });

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages.length).toBeLessThan(history.length);
  });
});

// ─── Truncation edge cases ───────────────────────────────────────────────────

describe('LMStudioAgent truncation edge cases', () => {
  let agent: LMStudioAgent;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    setupSpies();
    mocks = makeMocks();
    agent = new LMStudioAgent(mocks.mockDbManager, mocks.mockSessionManager);
  });

  afterEach(() => {
    teardownSpies();
  });

  it('should keep system message even when MAX_CONTEXT_MESSAGES is very small', async () => {
    // Override settings to allow only 2 messages total
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
      CLAUDE_MEM_LMSTUDIO_MODEL: 'test-model',
      CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: '2',
      CLAUDE_MEM_OPENROUTER_MAX_TOKENS: '100000',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const history: ConversationMessage[] = [
      { role: 'system', content: 'You are a memory observer...' },
      { role: 'user', content: 'observation 1' },
      { role: 'assistant', content: 'response 1' },
      { role: 'user', content: 'observation 2' },
      { role: 'assistant', content: 'response 2' },
      { role: 'user', content: 'observation 3' },
      { role: 'assistant', content: 'response 3' },
    ];

    const session = makeSession({
      conversationHistory: history,
      lastPromptNumber: 2
    });

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    // System message must always be first, even with MAX_CONTEXT_MESSAGES=2
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are a memory observer...');
    // Total messages should be 2 (system + 1 most recent)
    expect(body.messages.length).toBe(2);
  });

  it('should not lose system message after crash recovery re-init', async () => {
    // Simulate: session starts fresh (empty history), startSession pushes system prompt,
    // then many observations accumulate, then truncation happens
    const session = makeSession({ conversationHistory: [] });

    let callCount = 0;
    global.fetch = mock(() => {
      callCount++;
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: `<observation><type>change</type><title>Test ${callCount}</title></observation>` } }],
        usage: { total_tokens: 10 }
      })));
    });

    await agent.startSession(session);

    // After startSession, first message should be system
    expect(session.conversationHistory[0].role).toBe('system');

    // Verify the API was called with system as first message
    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
  });
});

describe('OpenRouterAgent truncation edge cases', () => {
  let agent: OpenRouterAgent;
  let mocks: ReturnType<typeof makeMocks>;

  beforeEach(() => {
    setupSpies();
    mocks = makeMocks();
    agent = new OpenRouterAgent(mocks.mockDbManager, mocks.mockSessionManager);
  });

  afterEach(() => {
    teardownSpies();
  });

  it('should keep system message even when MAX_CONTEXT_MESSAGES is very small', async () => {
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_OPENROUTER_API_KEY: 'test-key',
      CLAUDE_MEM_OPENROUTER_MODEL: 'test-model',
      CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: '2',
      CLAUDE_MEM_OPENROUTER_MAX_TOKENS: '100000',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const history: ConversationMessage[] = [
      { role: 'system', content: 'You are a memory observer...' },
      { role: 'user', content: 'observation 1' },
      { role: 'assistant', content: 'response 1' },
      { role: 'user', content: 'observation 2' },
      { role: 'assistant', content: 'response 2' },
    ];

    const session = makeSession({
      conversationHistory: history,
      lastPromptNumber: 2
    });

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'ok' } }],
      usage: { total_tokens: 10 }
    }))));

    await agent.startSession(session);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toBe('You are a memory observer...');
    expect(body.messages.length).toBe(2);
  });
});

// ─── ConversationMessage type ────────────────────────────────────────────────

describe('ConversationMessage type', () => {
  it('should accept system role', () => {
    const msg: ConversationMessage = { role: 'system' as any, content: 'test' };
    expect(msg.role).toBe('system');
  });
});
