/**
 * LMStudioAgent: Local LM Studio-based observation extraction
 *
 * Uses LM Studio's OpenAI-compatible REST API for zero-token
 * local inference. No API key required, no cost tracking.
 *
 * Responsibility:
 * - Call LM Studio REST API for observation extraction
 * - Parse XML responses (same format as Claude/Gemini/OpenRouter)
 * - Sync to database and Chroma
 * - Fallback to Claude SDK on connection errors
 */

import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import { logger } from '../../utils/logger.js';
import { buildInitPrompt, buildObservationPrompt, buildSummaryPrompt, buildContinuationPrompt } from '../../sdk/prompts.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import type { ActiveSession, ConversationMessage } from '../worker-types.js';
import { ModeManager } from '../domain/ModeManager.js';
import {
  processAgentResponse,
  shouldFallbackToClaude,
  isAbortError,
  type WorkerRef,
  type FallbackAgent
} from './agents/index.js';

// Default LM Studio endpoint
const DEFAULT_LMSTUDIO_BASE_URL = 'http://localhost:1234/v1';

// Context window management constants
const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_MAX_ESTIMATED_TOKENS = 100000;
const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_MAX_OUTPUT_TOKENS = 512;

// OpenAI-compatible message format
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface LMStudioResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

export class LMStudioAgent {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;
  private fallbackAgent: FallbackAgent | null = null;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  /**
   * Set the fallback agent (Claude SDK) for when LM Studio is unavailable
   */
  setFallbackAgent(agent: FallbackAgent): void {
    this.fallbackAgent = agent;
  }

  /**
   * Start LM Studio agent for a session
   */
  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    try {
      const { baseUrl, model } = this.getLMStudioConfig();

      // Load active mode
      const mode = ModeManager.getInstance().getActiveMode();

      // Build initial prompt
      const initPrompt = session.lastPromptNumber === 1
        ? buildInitPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
        : buildContinuationPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

      // Add to conversation history and query LM Studio
      // Use 'system' role so the LLM treats instructions as persistent system context
      session.conversationHistory.push({ role: 'system', content: initPrompt });
      const initResponse = await this.queryLMStudio(session.conversationHistory, baseUrl, model);

      if (initResponse.content) {
        // Generate synthetic memorySessionId since LM Studio REST API has no session concept
        // (Claude SDK provides this via query() response, but REST endpoints don't)
        if (!session.memorySessionId) {
          session.memorySessionId = `lmstudio-${session.contentSessionId}`;
          this.dbManager.getSessionStore().updateMemorySessionId(
            session.sessionDbId,
            session.memorySessionId
          );
          logger.info('SESSION', `MEMORY_ID_CAPTURED | sessionDbId=${session.sessionDbId} | memorySessionId=${session.memorySessionId} | provider=lmstudio`, {
            sessionId: session.sessionDbId,
            memorySessionId: session.memorySessionId
          });
        }

        session.conversationHistory.push({ role: 'assistant', content: initResponse.content });

        const tokensUsed = initResponse.tokensUsed || 0;
        session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
        session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);

        await processAgentResponse(
          initResponse.content,
          session,
          this.dbManager,
          this.sessionManager,
          worker,
          tokensUsed,
          null,
          'LMStudio',
          undefined
        );
      } else {
        logger.error('SDK', 'Empty LM Studio init response', {
          sessionId: session.sessionDbId,
          model
        });
      }

      // Track lastCwd from messages
      let lastCwd: string | undefined;

      // Process pending messages
      for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
        if (message.cwd) {
          lastCwd = message.cwd;
        }
        const originalTimestamp = session.earliestPendingTimestamp;

        if (message.type === 'observation') {
          if (message.prompt_number !== undefined) {
            session.lastPromptNumber = message.prompt_number;
          }

          const obsPrompt = buildObservationPrompt({
            id: 0,
            tool_name: message.tool_name!,
            tool_input: JSON.stringify(message.tool_input),
            tool_output: JSON.stringify(message.tool_response),
            created_at_epoch: originalTimestamp ?? Date.now(),
            cwd: message.cwd
          });

          session.conversationHistory.push({ role: 'user', content: obsPrompt });
          const obsResponse = await this.queryLMStudio(session.conversationHistory, baseUrl, model);

          let tokensUsed = 0;
          if (obsResponse.content) {
            session.conversationHistory.push({ role: 'assistant', content: obsResponse.content });
            tokensUsed = obsResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          await processAgentResponse(
            obsResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'LMStudio',
            lastCwd
          );

        } else if (message.type === 'summarize') {
          const summaryPrompt = buildSummaryPrompt({
            id: session.sessionDbId,
            memory_session_id: session.memorySessionId,
            project: session.project,
            user_prompt: session.userPrompt,
            last_assistant_message: message.last_assistant_message || ''
          }, mode);

          session.conversationHistory.push({ role: 'user', content: summaryPrompt });
          const summaryResponse = await this.queryLMStudio(session.conversationHistory, baseUrl, model);

          let tokensUsed = 0;
          if (summaryResponse.content) {
            session.conversationHistory.push({ role: 'assistant', content: summaryResponse.content });
            tokensUsed = summaryResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          await processAgentResponse(
            summaryResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'LMStudio',
            lastCwd
          );
        }
      }

      // Mark session complete
      const sessionDuration = Date.now() - session.startTime;
      logger.success('SDK', 'LM Studio agent completed', {
        sessionId: session.sessionDbId,
        duration: `${(sessionDuration / 1000).toFixed(1)}s`,
        historyLength: session.conversationHistory.length,
        model
      });

    } catch (error: unknown) {
      if (isAbortError(error)) {
        logger.warn('SDK', 'LM Studio agent aborted', { sessionId: session.sessionDbId });
        throw error;
      }

      if (shouldFallbackToClaude(error) && this.fallbackAgent) {
        logger.warn('SDK', 'LM Studio unavailable, falling back to Claude SDK', {
          sessionDbId: session.sessionDbId,
          error: error instanceof Error ? error.message : String(error),
          historyLength: session.conversationHistory.length
        });

        return this.fallbackAgent.startSession(session, worker);
      }

      logger.failure('SDK', 'LM Studio agent error', { sessionDbId: session.sessionDbId }, error as Error);
      throw error;
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  private truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const MAX_CONTEXT_MESSAGES = parseInt(settings.CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES) || DEFAULT_MAX_CONTEXT_MESSAGES;
    const MAX_ESTIMATED_TOKENS = parseInt(settings.CLAUDE_MEM_OPENROUTER_MAX_TOKENS) || DEFAULT_MAX_ESTIMATED_TOKENS;

    if (history.length <= MAX_CONTEXT_MESSAGES) {
      const totalTokens = history.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
      if (totalTokens <= MAX_ESTIMATED_TOKENS) {
        return history;
      }
    }

    // Always preserve the system message (index 0) if present
    const systemMsg = history.length > 0 && history[0].role === 'system' ? history[0] : null;
    const startIndex = systemMsg ? 1 : 0;

    const truncated: ConversationMessage[] = [];
    let tokenCount = 0;

    // Reserve budget for system message
    if (systemMsg) {
      tokenCount += this.estimateTokens(systemMsg.content);
    }

    for (let i = history.length - 1; i >= startIndex; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (truncated.length >= (MAX_CONTEXT_MESSAGES - (systemMsg ? 1 : 0)) || tokenCount + msgTokens > MAX_ESTIMATED_TOKENS) {
        logger.warn('SDK', 'LM Studio context window truncated', {
          originalMessages: history.length,
          keptMessages: truncated.length + (systemMsg ? 1 : 0),
          droppedMessages: i + 1 - startIndex,
          estimatedTokens: tokenCount,
          tokenLimit: MAX_ESTIMATED_TOKENS
        });
        break;
      }

      truncated.unshift(msg);
      tokenCount += msgTokens;
    }

    // Prepend system message
    if (systemMsg) {
      truncated.unshift(systemMsg);
    }

    return truncated;
  }

  private conversationToOpenAIMessages(history: ConversationMessage[]): OpenAIMessage[] {
    return history.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : msg.role === 'system' ? 'system' : 'user',
      content: msg.content
    }));
  }

  /**
   * Query LM Studio via OpenAI-compatible REST API
   */
  private async queryLMStudio(
    history: ConversationMessage[],
    baseUrl: string,
    model: string
  ): Promise<{ content: string; tokensUsed?: number }> {
    const truncatedHistory = this.truncateHistory(history);
    const messages = this.conversationToOpenAIMessages(truncatedHistory);
    const totalChars = truncatedHistory.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = this.estimateTokens(truncatedHistory.map(m => m.content).join(''));

    logger.debug('SDK', `Querying LM Studio (${model})`, {
      turns: truncatedHistory.length,
      totalChars,
      estimatedTokens
    });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        max_tokens: this.getMaxOutputTokens(),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LM Studio API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as LMStudioResponse;

    if (data.error) {
      throw new Error(`LM Studio API error: ${data.error.code} - ${data.error.message}`);
    }

    if (!data.choices?.[0]?.message?.content) {
      logger.error('SDK', 'Empty response from LM Studio');
      return { content: '' };
    }

    const content = data.choices[0].message.content;
    const tokensUsed = data.usage?.total_tokens;

    if (tokensUsed) {
      const inputTokens = data.usage?.prompt_tokens || 0;
      const outputTokens = data.usage?.completion_tokens || 0;

      logger.info('SDK', 'LM Studio usage (local, no cost)', {
        model,
        inputTokens,
        outputTokens,
        totalTokens: tokensUsed,
        messagesInContext: truncatedHistory.length
      });
    }

    return { content, tokensUsed };
  }

  /**
   * Get LM Studio configuration from settings
   */
  private getLMStudioConfig(): { baseUrl: string; model: string } {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const baseUrl = settings.CLAUDE_MEM_LMSTUDIO_BASE_URL || DEFAULT_LMSTUDIO_BASE_URL;
    const model = settings.CLAUDE_MEM_LMSTUDIO_MODEL || 'ibm/granite-4-h-tiny';

    return { baseUrl, model };
  }

  private getMaxOutputTokens(): number {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    return parseInt(settings.CLAUDE_MEM_LMSTUDIO_MAX_OUTPUT_TOKENS) || DEFAULT_MAX_OUTPUT_TOKENS;
  }
}

/**
 * Check if LM Studio is available (has model configured)
 */
export function isLMStudioAvailable(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  return !!(settings.CLAUDE_MEM_LMSTUDIO_MODEL || settings.CLAUDE_MEM_LMSTUDIO_BASE_URL);
}

/**
 * Check if LM Studio is the selected provider
 */
export function isLMStudioSelected(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  return settings.CLAUDE_MEM_PROVIDER === 'lmstudio';
}
