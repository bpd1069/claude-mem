import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { LMStudioAgent, isLMStudioSelected, isLMStudioAvailable } from '../src/services/worker/LMStudioAgent';
import { DatabaseManager } from '../src/services/worker/DatabaseManager';
import { SessionManager } from '../src/services/worker/SessionManager';
import { ModeManager } from '../src/services/domain/ModeManager';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager';

// Mock mode config
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

let loadFromFileSpy: ReturnType<typeof spyOn>;
let getSpy: ReturnType<typeof spyOn>;
let modeManagerSpy: ReturnType<typeof spyOn>;

function makeSession(overrides: Record<string, any> = {}) {
  return {
    sessionDbId: 1,
    contentSessionId: 'test-session',
    memorySessionId: 'mem-session-123',
    project: 'test-project',
    userPrompt: 'test prompt',
    conversationHistory: [],
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

function makeOpenAIResponse(content: string, totalTokens?: number) {
  const resp: any = {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  };
  if (totalTokens !== undefined) {
    resp.usage = { prompt_tokens: Math.floor(totalTokens * 0.7), completion_tokens: Math.floor(totalTokens * 0.3), total_tokens: totalTokens };
  }
  return resp;
}

describe('LMStudioAgent', () => {
  let agent: LMStudioAgent;
  let originalFetch: typeof global.fetch;

  let mockStoreObservations: any;
  let mockStoreSummary: any;
  let mockMarkSessionCompleted: any;
  let mockSyncObservation: any;
  let mockSyncSummary: any;
  let mockMarkProcessed: any;
  let mockCleanupProcessed: any;
  let mockResetStuckMessages: any;
  let mockUpdateMemorySessionId: any;
  let mockDbManager: DatabaseManager;
  let mockSessionManager: SessionManager;

  beforeEach(() => {
    modeManagerSpy = spyOn(ModeManager, 'getInstance').mockImplementation(() => ({
      getActiveMode: () => mockMode,
      loadMode: () => {},
    } as any));

    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_PROVIDER: 'lmstudio',
      CLAUDE_MEM_LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',
      CLAUDE_MEM_LMSTUDIO_MODEL: 'ibm/granite-4-h-tiny',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    getSpy = spyOn(SettingsDefaultsManager, 'get').mockImplementation((key: string) => {
      if (key === 'CLAUDE_MEM_PROVIDER') return 'lmstudio';
      if (key === 'CLAUDE_MEM_LMSTUDIO_BASE_URL') return 'http://localhost:1234/v1';
      if (key === 'CLAUDE_MEM_LMSTUDIO_MODEL') return 'ibm/granite-4-h-tiny';
      if (key === 'CLAUDE_MEM_DATA_DIR') return '/tmp/claude-mem-test';
      return SettingsDefaultsManager.getAllDefaults()[key as keyof ReturnType<typeof SettingsDefaultsManager.getAllDefaults>] ?? '';
    });

    mockUpdateMemorySessionId = mock(() => {});
    mockStoreObservations = mock(() => ({
      observationIds: [1],
      summaryId: 1,
      createdAtEpoch: Date.now()
    }));
    mockStoreSummary = mock(() => ({ id: 1, createdAtEpoch: Date.now() }));
    mockMarkSessionCompleted = mock(() => {});
    mockSyncObservation = mock(() => Promise.resolve());
    mockSyncSummary = mock(() => Promise.resolve());
    mockMarkProcessed = mock(() => {});
    mockCleanupProcessed = mock(() => 0);
    mockResetStuckMessages = mock(() => 0);

    const mockSessionStore = {
      storeObservation: mock(() => ({ id: 1, createdAtEpoch: Date.now() })),
      storeObservations: mockStoreObservations,
      storeSummary: mockStoreSummary,
      markSessionCompleted: mockMarkSessionCompleted,
      updateMemorySessionId: mockUpdateMemorySessionId,
    };

    const mockChromaSync = {
      syncObservation: mockSyncObservation,
      syncSummary: mockSyncSummary
    };

    mockDbManager = {
      getSessionStore: () => mockSessionStore,
      getChromaSync: () => mockChromaSync
    } as unknown as DatabaseManager;

    const mockPendingMessageStore = {
      markProcessed: mockMarkProcessed,
      cleanupProcessed: mockCleanupProcessed,
      resetStuckMessages: mockResetStuckMessages
    };

    mockSessionManager = {
      getMessageIterator: async function* () { yield* []; },
      getPendingMessageStore: () => mockPendingMessageStore
    } as unknown as SessionManager;

    agent = new LMStudioAgent(mockDbManager, mockSessionManager);
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (modeManagerSpy) modeManagerSpy.mockRestore();
    if (loadFromFileSpy) loadFromFileSpy.mockRestore();
    if (getSpy) getSpy.mockRestore();
    mock.restore();
  });

  it('should initialize with correct config', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse('<observation><type>discovery</type><title>Test</title></observation>', 100)
    ))));

    await agent.startSession(session);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
  });

  it('should handle multi-turn conversation', async () => {
    const session = makeSession({
      conversationHistory: [
        { role: 'user', content: 'prev context' },
        { role: 'assistant', content: 'prev response' }
      ],
      lastPromptNumber: 2
    });

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse('response')
    ))));

    await agent.startSession(session);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.messages).toHaveLength(3);
    expect(body.messages[0].role).toBe('user');
    expect(body.messages[1].role).toBe('assistant');
    expect(body.messages[2].role).toBe('user');
  });

  it('should process observations and store them', async () => {
    const session = makeSession();

    const observationXml = `
      <observation>
        <type>discovery</type>
        <title>Found bug</title>
        <subtitle>Null pointer</subtitle>
        <narrative>Found a null pointer in the code</narrative>
        <facts><fact>Null check missing</fact></facts>
        <concepts><concept>bug</concept></concepts>
        <files_read><file>src/main.ts</file></files_read>
        <files_modified></files_modified>
      </observation>
    `;

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse(observationXml, 50)
    ))));

    await agent.startSession(session);

    expect(mockStoreObservations).toHaveBeenCalled();
    expect(mockSyncObservation).toHaveBeenCalled();
    expect(session.cumulativeInputTokens).toBeGreaterThan(0);
  });

  it('should fallback to Claude on ECONNREFUSED', async () => {
    const session = makeSession();

    global.fetch = mock(() => {
      const err = new Error('fetch failed');
      (err as any).cause = new Error('connect ECONNREFUSED 127.0.0.1:1234');
      return Promise.reject(err);
    });

    const fallbackAgent = {
      startSession: mock(() => Promise.resolve())
    };
    agent.setFallbackAgent(fallbackAgent);

    await agent.startSession(session);

    expect(fallbackAgent.startSession).toHaveBeenCalledWith(session, undefined);
  });

  it('should NOT fallback on 400 errors', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response('Invalid argument', { status: 400 })));

    const fallbackAgent = {
      startSession: mock(() => Promise.resolve())
    };
    agent.setFallbackAgent(fallbackAgent);

    await expect(agent.startSession(session)).rejects.toThrow('LM Studio API error: 400 - Invalid argument');
    expect(fallbackAgent.startSession).not.toHaveBeenCalled();
  });

  it('should work without API key (no Authorization header)', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse('ok')
    ))));

    await agent.startSession(session);

    const headers = (global.fetch as any).mock.calls[0][1].headers;
    expect(headers).not.toHaveProperty('Authorization');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('should use configured model from settings', async () => {
    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse('ok')
    ))));

    await agent.startSession(session);

    const body = JSON.parse((global.fetch as any).mock.calls[0][1].body);
    expect(body.model).toBe('ibm/granite-4-h-tiny');
  });

  describe('memorySessionId synthesis', () => {
    it('should generate synthetic memorySessionId when null', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
        makeOpenAIResponse('<no_observation/>')
      ))));

      await agent.startSession(session);

      expect(session.memorySessionId).toBe('lmstudio-test-session');
    });

    it('should persist synthetic memorySessionId to database', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
        makeOpenAIResponse('<no_observation/>')
      ))));

      await agent.startSession(session);

      expect(mockUpdateMemorySessionId).toHaveBeenCalledWith(1, 'lmstudio-test-session');
    });

    it('should not overwrite existing memorySessionId', async () => {
      const session = makeSession({ memorySessionId: 'existing-id' });

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
        makeOpenAIResponse('<no_observation/>')
      ))));

      await agent.startSession(session);

      expect(session.memorySessionId).toBe('existing-id');
      expect(mockUpdateMemorySessionId).not.toHaveBeenCalled();
    });

    it('should store observations after memorySessionId is synthesized', async () => {
      const session = makeSession({ memorySessionId: null });

      const observationXml = `
        <observation>
          <type>discovery</type>
          <title>Test obs</title>
          <subtitle>Sub</subtitle>
          <narrative>Narrative</narrative>
          <facts><fact>Fact</fact></facts>
          <concepts><concept>test</concept></concepts>
          <files_read><file>src/main.ts</file></files_read>
          <files_modified></files_modified>
        </observation>
      `;

      global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
        makeOpenAIResponse(observationXml, 50)
      ))));

      await agent.startSession(session);

      // memorySessionId set before processAgentResponse, so observations should store
      expect(session.memorySessionId).toBe('lmstudio-test-session');
      expect(mockStoreObservations).toHaveBeenCalled();
    });
  });

  it('should use default base URL when not configured', async () => {
    // Override to return empty base URL
    loadFromFileSpy.mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_PROVIDER: 'lmstudio',
      CLAUDE_MEM_LMSTUDIO_BASE_URL: '',
      CLAUDE_MEM_LMSTUDIO_MODEL: 'test-model',
      CLAUDE_MEM_DATA_DIR: '/tmp/claude-mem-test',
    }));

    const session = makeSession();

    global.fetch = mock(() => Promise.resolve(new Response(JSON.stringify(
      makeOpenAIResponse('ok')
    ))));

    await agent.startSession(session);

    const url = (global.fetch as any).mock.calls[0][0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
  });

  describe('fallback to Claude SDK', () => {
    it('should fallback on connection refused (LM Studio not running)', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => {
        const err = new Error('fetch failed');
        (err as any).cause = new Error('connect ECONNREFUSED 127.0.0.1:1234');
        return Promise.reject(err);
      });

      const fallbackAgent = {
        startSession: mock(() => Promise.resolve())
      };
      agent.setFallbackAgent(fallbackAgent);

      await agent.startSession(session);

      expect(fallbackAgent.startSession).toHaveBeenCalledWith(session, undefined);
    });

    it('should fallback on ETIMEDOUT', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => Promise.reject(new Error('connect ETIMEDOUT 127.0.0.1:1234')));

      const fallbackAgent = {
        startSession: mock(() => Promise.resolve())
      };
      agent.setFallbackAgent(fallbackAgent);

      await agent.startSession(session);

      expect(fallbackAgent.startSession).toHaveBeenCalledWith(session, undefined);
    });

    it('should NOT fallback on 400 client errors', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => Promise.resolve(new Response('Bad request', { status: 400 })));

      const fallbackAgent = {
        startSession: mock(() => Promise.resolve())
      };
      agent.setFallbackAgent(fallbackAgent);

      await expect(agent.startSession(session)).rejects.toThrow('LM Studio API error: 400');
      expect(fallbackAgent.startSession).not.toHaveBeenCalled();
    });

    it('should throw when no fallback agent is set and LM Studio fails', async () => {
      const session = makeSession({ memorySessionId: null });

      global.fetch = mock(() => Promise.reject(new Error('fetch failed')));

      // No fallback set
      await expect(agent.startSession(session)).rejects.toThrow('fetch failed');
    });
  });
});

describe('isLMStudioSelected / isLMStudioAvailable', () => {
  let loadFromFileSpy: ReturnType<typeof spyOn>;

  afterEach(() => {
    if (loadFromFileSpy) loadFromFileSpy.mockRestore();
  });

  it('should return true when CLAUDE_MEM_PROVIDER is lmstudio', () => {
    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_PROVIDER: 'lmstudio',
      CLAUDE_MEM_LMSTUDIO_MODEL: 'ibm/granite-4-h-tiny',
    }));

    expect(isLMStudioSelected()).toBe(true);
    expect(isLMStudioAvailable()).toBe(true);
  });

  it('should return false when CLAUDE_MEM_PROVIDER is claude', () => {
    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_PROVIDER: 'claude',
    }));

    expect(isLMStudioSelected()).toBe(false);
  });

  it('should return available=false when no model configured', () => {
    loadFromFileSpy = spyOn(SettingsDefaultsManager, 'loadFromFile').mockImplementation(() => ({
      ...SettingsDefaultsManager.getAllDefaults(),
      CLAUDE_MEM_PROVIDER: 'lmstudio',
      CLAUDE_MEM_LMSTUDIO_MODEL: '',
      CLAUDE_MEM_LMSTUDIO_BASE_URL: '',
    }));

    expect(isLMStudioSelected()).toBe(true);
    expect(isLMStudioAvailable()).toBe(false);
  });
});
