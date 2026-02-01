/**
 * SettingsDefaultsManager
 *
 * Single source of truth for all default configuration values.
 * Provides methods to get defaults with optional environment variable overrides.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import { DEFAULT_OBSERVATION_TYPES_STRING, DEFAULT_OBSERVATION_CONCEPTS_STRING } from '../constants/observation-metadata.js';
// NOTE: Do NOT import logger here - it creates a circular dependency
// logger.ts depends on SettingsDefaultsManager for its initialization

export interface SettingsDefaults {
  CLAUDE_MEM_MODEL: string;
  CLAUDE_MEM_CONTEXT_OBSERVATIONS: string;
  CLAUDE_MEM_WORKER_PORT: string;
  CLAUDE_MEM_WORKER_HOST: string;
  CLAUDE_MEM_SKIP_TOOLS: string;
  // AI Provider Configuration
  CLAUDE_MEM_PROVIDER: string;  // 'claude' | 'gemini' | 'openrouter'
  CLAUDE_MEM_GEMINI_API_KEY: string;
  CLAUDE_MEM_GEMINI_MODEL: string;  // 'gemini-2.5-flash-lite' | 'gemini-2.5-flash' | 'gemini-3-flash'
  CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: string;  // 'true' | 'false' - enable rate limiting for free tier
  CLAUDE_MEM_OPENROUTER_API_KEY: string;
  CLAUDE_MEM_OPENROUTER_MODEL: string;
  CLAUDE_MEM_OPENROUTER_SITE_URL: string;
  CLAUDE_MEM_OPENROUTER_APP_NAME: string;
  CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: string;
  CLAUDE_MEM_OPENROUTER_MAX_TOKENS: string;
  // LM Studio Configuration
  CLAUDE_MEM_LMSTUDIO_BASE_URL: string;
  CLAUDE_MEM_LMSTUDIO_MODEL: string;
  // System Configuration
  CLAUDE_MEM_DATA_DIR: string;
  CLAUDE_MEM_LOG_LEVEL: string;
  CLAUDE_MEM_PYTHON_VERSION: string;
  CLAUDE_CODE_PATH: string;
  CLAUDE_MEM_MODE: string;
  // Token Economics
  CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS: string;
  CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: string;
  CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: string;
  // Observation Filtering
  CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: string;
  CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: string;
  // Display Configuration
  CLAUDE_MEM_CONTEXT_FULL_COUNT: string;
  CLAUDE_MEM_CONTEXT_FULL_FIELD: string;
  CLAUDE_MEM_CONTEXT_SESSION_COUNT: string;
  // Feature Toggles
  CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: string;
  CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE: string;
  // Vector Backend Configuration
  VECTOR_BACKEND: string;  // 'chroma' | 'sqlite-vec' | 'none'
  EMBEDDING_PROVIDER: string;  // 'lmstudio' | 'openai' | 'openai-compatible'
  EMBEDDING_MODEL: string;
  EMBEDDING_DIMENSIONS: string;
  OPENAI_API_KEY: string;  // For OpenAI embedding provider
  // Git-LFS Export Configuration ("Resurrection Ship" - separate from codebases)
  GIT_LFS_ENABLED: string;
  GIT_LFS_REMOTE: string;
  GIT_LFS_REMOTE_URL: string;  // Dedicated memory repo, NOT your project repo
  GIT_LFS_AUTO_PUSH: string;
  GIT_LFS_IDLE_PUSH_SECONDS: string;
  GIT_LFS_TEAM_REPOS: string;  // Future: comma-separated list of team memory repos
  // Federation Constraints (Tetrahedron Model: local + 3 remotes max)
  FEDERATION_MAX_REMOTES: string;  // Hard limit: 3 (forms tetrahedron with local)
  FEDERATION_QUERY_TIMEOUT_MS: string;  // Per-remote timeout
  FEDERATION_PRIORITY_DECAY: string;  // 'golden' | 'exponential' | 'linear'
  FEDERATION_ALLOW_LIST: string;  // Comma-separated allowed remote URLs (security)
  FEDERATION_READ_ONLY: string;  // Remotes are read-only by default
  FEDERATION_TOTAL_TIMEOUT_MS: string;  // Total query budget across all remotes
}

export class SettingsDefaultsManager {
  /**
   * Default values for all settings
   */
  private static readonly DEFAULTS: SettingsDefaults = {
    CLAUDE_MEM_MODEL: 'claude-sonnet-4-5',
    CLAUDE_MEM_CONTEXT_OBSERVATIONS: '50',
    CLAUDE_MEM_WORKER_PORT: '37777',
    CLAUDE_MEM_WORKER_HOST: '127.0.0.1',
    CLAUDE_MEM_SKIP_TOOLS: 'ListMcpResourcesTool,SlashCommand,Skill,TodoWrite,AskUserQuestion',
    // AI Provider Configuration
    CLAUDE_MEM_PROVIDER: 'claude',  // Default to Claude
    CLAUDE_MEM_GEMINI_API_KEY: '',  // Empty by default, can be set via UI or env
    CLAUDE_MEM_GEMINI_MODEL: 'gemini-2.5-flash-lite',  // Default Gemini model (highest free tier RPM)
    CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED: 'true',  // Rate limiting ON by default for free tier users
    CLAUDE_MEM_OPENROUTER_API_KEY: '',  // Empty by default, can be set via UI or env
    CLAUDE_MEM_OPENROUTER_MODEL: 'xiaomi/mimo-v2-flash:free',  // Default OpenRouter model (free tier)
    CLAUDE_MEM_OPENROUTER_SITE_URL: '',  // Optional: for OpenRouter analytics
    CLAUDE_MEM_OPENROUTER_APP_NAME: 'claude-mem',  // App name for OpenRouter analytics
    CLAUDE_MEM_OPENROUTER_MAX_CONTEXT_MESSAGES: '20',  // Max messages in context window
    CLAUDE_MEM_OPENROUTER_MAX_TOKENS: '100000',  // Max estimated tokens (~100k safety limit)
    // LM Studio Configuration
    CLAUDE_MEM_LMSTUDIO_BASE_URL: 'http://localhost:1234/v1',  // Default LM Studio endpoint
    CLAUDE_MEM_LMSTUDIO_MODEL: '',  // Model loaded in LM Studio (empty for default)
    // System Configuration
    CLAUDE_MEM_DATA_DIR: join(homedir(), '.claude-mem'),
    CLAUDE_MEM_LOG_LEVEL: 'INFO',
    CLAUDE_MEM_PYTHON_VERSION: '3.13',
    CLAUDE_CODE_PATH: '', // Empty means auto-detect via 'which claude'
    CLAUDE_MEM_MODE: 'code', // Default mode profile
    // Token Economics
    CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT: 'true',
    // Observation Filtering
    CLAUDE_MEM_CONTEXT_OBSERVATION_TYPES: DEFAULT_OBSERVATION_TYPES_STRING,
    CLAUDE_MEM_CONTEXT_OBSERVATION_CONCEPTS: DEFAULT_OBSERVATION_CONCEPTS_STRING,
    // Display Configuration
    CLAUDE_MEM_CONTEXT_FULL_COUNT: '5',
    CLAUDE_MEM_CONTEXT_FULL_FIELD: 'narrative',
    CLAUDE_MEM_CONTEXT_SESSION_COUNT: '10',
    // Feature Toggles
    CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: 'true',
    CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE: 'false',
    // Vector Backend Configuration
    VECTOR_BACKEND: 'chroma',  // Default to ChromaDB for backwards compatibility
    EMBEDDING_PROVIDER: 'lmstudio',  // Default to local LM Studio
    EMBEDDING_MODEL: 'text-embedding-nomic-embed-text-v1.5',  // Good local embedding model
    EMBEDDING_DIMENSIONS: '768',
    OPENAI_API_KEY: '',  // Empty by default
    // Git-LFS Export Configuration ("Resurrection Ship" - separate from codebases)
    GIT_LFS_ENABLED: 'false',  // Disabled by default
    GIT_LFS_REMOTE: 'origin',
    GIT_LFS_REMOTE_URL: '',  // Dedicated memory repo URL, NOT your project repo
    GIT_LFS_AUTO_PUSH: 'false',  // Manual push by default
    GIT_LFS_IDLE_PUSH_SECONDS: '300',  // 5 minutes idle before auto-push
    GIT_LFS_TEAM_REPOS: '',  // Future: comma-separated list of team memory repos to sync
    // Federation Constraints (Tetrahedron Model: local + 3 remotes max)
    // Geometric rationale: tetrahedron is minimal stable 3D structure
    // Priority uses golden ratio decay: 1.0, 0.618, 0.382, 0.236
    FEDERATION_MAX_REMOTES: '3',  // Hard limit (local + 3 = tetrahedron vertices)
    FEDERATION_QUERY_TIMEOUT_MS: '5000',  // 5s per-remote timeout
    FEDERATION_PRIORITY_DECAY: 'golden',  // φ decay: 1/φ^n where φ=1.618
    FEDERATION_ALLOW_LIST: '',  // Empty = allow all; set URLs for security
    FEDERATION_READ_ONLY: 'true',  // Remotes are read-only (security)
    FEDERATION_TOTAL_TIMEOUT_MS: '15000',  // 15s total budget (3 remotes × 5s)
  };

  /**
   * Get all defaults as an object
   */
  static getAllDefaults(): SettingsDefaults {
    return { ...this.DEFAULTS };
  }

  /**
   * Get a default value from defaults (no environment variable override)
   */
  static get(key: keyof SettingsDefaults): string {
    return this.DEFAULTS[key];
  }

  /**
   * Get an integer default value
   */
  static getInt(key: keyof SettingsDefaults): number {
    const value = this.get(key);
    return parseInt(value, 10);
  }

  /**
   * Get a boolean default value
   */
  static getBool(key: keyof SettingsDefaults): boolean {
    const value = this.get(key);
    return value === 'true';
  }

  /**
   * Load settings from file with fallback to defaults
   * Returns merged settings with defaults as fallback
   * Handles all errors (missing file, corrupted JSON, permissions) by returning defaults
   */
  static loadFromFile(settingsPath: string): SettingsDefaults {
    try {
      if (!existsSync(settingsPath)) {
        const defaults = this.getAllDefaults();
        try {
          const dir = dirname(settingsPath);
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8');
          // Use console instead of logger to avoid circular dependency
          console.log('[SETTINGS] Created settings file with defaults:', settingsPath);
        } catch (error) {
          console.warn('[SETTINGS] Failed to create settings file, using in-memory defaults:', settingsPath, error);
        }
        return defaults;
      }

      const settingsData = readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(settingsData);

      // MIGRATION: Handle old nested schema { env: {...} }
      let flatSettings = settings;
      if (settings.env && typeof settings.env === 'object') {
        // Migrate from nested to flat schema
        flatSettings = settings.env;

        // Auto-migrate the file to flat schema
        try {
          writeFileSync(settingsPath, JSON.stringify(flatSettings, null, 2), 'utf-8');
          console.log('[SETTINGS] Migrated settings file from nested to flat schema:', settingsPath);
        } catch (error) {
          console.warn('[SETTINGS] Failed to auto-migrate settings file:', settingsPath, error);
          // Continue with in-memory migration even if write fails
        }
      }

      // Merge file settings with defaults (flat schema)
      const result: SettingsDefaults = { ...this.DEFAULTS };
      for (const key of Object.keys(this.DEFAULTS) as Array<keyof SettingsDefaults>) {
        if (flatSettings[key] !== undefined) {
          result[key] = flatSettings[key];
        }
      }

      return result;
    } catch (error) {
      console.warn('[SETTINGS] Failed to load settings, using defaults:', settingsPath, error);
      return this.getAllDefaults();
    }
  }
}
