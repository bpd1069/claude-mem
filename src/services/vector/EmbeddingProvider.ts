/**
 * EmbeddingProvider
 *
 * Abstraction for generating vector embeddings from text.
 * Required by sqlite-vec backend (ChromaDB handles embeddings internally).
 *
 * Supported providers:
 * - LM Studio (local inference)
 * - OpenAI-compatible API (any provider with /v1/embeddings endpoint)
 */

import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';

/**
 * Result from embedding generation
 */
export interface EmbeddingResult {
  embedding: number[];
  dimensions: number;
  model: string;
  tokensUsed?: number;
}

/**
 * Configuration for embedding providers
 */
export interface EmbeddingConfig {
  provider: 'lmstudio' | 'openai' | 'openai-compatible';
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  dimensions?: number;
}

/**
 * Interface for embedding providers
 */
export interface IEmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;

  /**
   * Generate embeddings for a batch of texts
   */
  embed(texts: string[]): Promise<EmbeddingResult[]>;

  /**
   * Generate embedding for a single text
   */
  embedSingle(text: string): Promise<EmbeddingResult>;
}

/**
 * LM Studio embedding provider
 * Uses local LM Studio server with OpenAI-compatible API
 */
export class LMStudioEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'lmstudio';
  readonly dimensions: number;

  private baseUrl: string;
  private model: string;

  constructor(config?: Partial<EmbeddingConfig>) {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    this.baseUrl = config?.baseUrl || settings.CLAUDE_MEM_LMSTUDIO_BASE_URL || 'http://localhost:1234/v1';
    this.model = config?.model || (settings as any).EMBEDDING_MODEL || 'text-embedding-nomic-embed-text-v1.5';
    this.dimensions = config?.dimensions || (settings as any).EMBEDDING_DIMENSIONS || 768;

    logger.debug('EMBEDDING', 'LM Studio provider initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
      dimensions: this.dimensions
    });
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          input: texts
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LM Studio embedding failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        model: string;
        usage?: { total_tokens: number };
      };

      // Sort by index to maintain order
      const sorted = data.data.sort((a, b) => a.index - b.index);

      return sorted.map(item => ({
        embedding: item.embedding,
        dimensions: item.embedding.length,
        model: data.model || this.model,
        tokensUsed: data.usage?.total_tokens
      }));
    } catch (error) {
      logger.error('EMBEDDING', 'LM Studio embedding failed', {
        baseUrl: this.baseUrl,
        textCount: texts.length
      }, error as Error);
      throw error;
    }
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.embed([text]);
    return results[0];
  }
}

/**
 * OpenAI-compatible embedding provider
 * Works with OpenAI, Azure OpenAI, and other compatible APIs
 */
export class OpenAIEmbeddingProvider implements IEmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions: number;

  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(config?: Partial<EmbeddingConfig>) {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    this.baseUrl = config?.baseUrl || 'https://api.openai.com/v1';
    this.apiKey = config?.apiKey || (settings as any).OPENAI_API_KEY || '';
    this.model = config?.model || (settings as any).EMBEDDING_MODEL || 'text-embedding-3-small';
    this.dimensions = config?.dimensions || (settings as any).EMBEDDING_DIMENSIONS || 1536;

    if (!this.apiKey) {
      logger.warn('EMBEDDING', 'OpenAI API key not configured');
    }

    logger.debug('EMBEDDING', 'OpenAI provider initialized', {
      baseUrl: this.baseUrl,
      model: this.model,
      dimensions: this.dimensions
    });
  }

  async embed(texts: string[]): Promise<EmbeddingResult[]> {
    if (texts.length === 0) return [];

    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    try {
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          input: texts,
          dimensions: this.dimensions
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI embedding failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        data: Array<{ embedding: number[]; index: number }>;
        model: string;
        usage?: { total_tokens: number };
      };

      const sorted = data.data.sort((a, b) => a.index - b.index);

      return sorted.map(item => ({
        embedding: item.embedding,
        dimensions: item.embedding.length,
        model: data.model || this.model,
        tokensUsed: data.usage?.total_tokens
      }));
    } catch (error) {
      logger.error('EMBEDDING', 'OpenAI embedding failed', {
        baseUrl: this.baseUrl,
        textCount: texts.length
      }, error as Error);
      throw error;
    }
  }

  async embedSingle(text: string): Promise<EmbeddingResult> {
    const results = await this.embed([text]);
    return results[0];
  }
}

/**
 * Factory function to create embedding provider based on settings
 */
export function createEmbeddingProvider(config?: Partial<EmbeddingConfig>): IEmbeddingProvider {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const provider = config?.provider || (settings as any).EMBEDDING_PROVIDER || 'lmstudio';

  switch (provider) {
    case 'lmstudio':
      return new LMStudioEmbeddingProvider(config);
    case 'openai':
    case 'openai-compatible':
      return new OpenAIEmbeddingProvider(config);
    default:
      logger.warn('EMBEDDING', `Unknown provider: ${provider}, using lmstudio`);
      return new LMStudioEmbeddingProvider(config);
  }
}

/**
 * Convert embedding array to SQLite BLOB format (float32)
 */
export function embeddingToBlob(embedding: number[]): Buffer {
  const buffer = Buffer.alloc(embedding.length * 4);
  for (let i = 0; i < embedding.length; i++) {
    buffer.writeFloatLE(embedding[i], i * 4);
  }
  return buffer;
}

/**
 * Convert SQLite BLOB to embedding array
 */
export function blobToEmbedding(blob: Buffer): number[] {
  const embedding: number[] = [];
  for (let i = 0; i < blob.length; i += 4) {
    embedding.push(blob.readFloatLE(i));
  }
  return embedding;
}
