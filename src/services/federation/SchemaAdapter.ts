/**
 * Schema Adapter for Federation
 *
 * Transforms external database schemas to internal format without
 * modifying our schema. Each remote can have its own adapter config.
 *
 * Design principle: Mutable external schemas, immutable internal schema.
 */

/**
 * Field mapping from external schema to internal schema
 */
export interface FieldMapping {
  // Core observation fields
  id?: string;              // External field name for ID
  title?: string;           // External field for title
  subtitle?: string;        // External field for subtitle
  narrative?: string;       // External field for narrative/content
  facts?: string;           // External field for facts array
  type?: string;            // External field for observation type
  project?: string;         // External field for project name
  timestamp?: string;       // External field for timestamp
  embedding?: string;       // External field for vector embedding
}

/**
 * Value transformers for type conversion
 */
export type TimestampFormat = 'epoch_ms' | 'epoch_s' | 'iso8601' | 'unix';
export type EmbeddingFormat = 'array' | 'base64' | 'json_array' | 'binary';
export type ArrayFormat = 'json' | 'csv' | 'array';

export interface ValueTransforms {
  timestamp?: TimestampFormat;
  embedding?: EmbeddingFormat;
  facts?: ArrayFormat;
  concepts?: ArrayFormat;
}

/**
 * Complete adapter configuration for a remote database
 */
export interface RemoteSchemaConfig {
  id: string;                    // Unique adapter ID
  name: string;                  // Human-readable name
  url: string;                   // Remote database URL
  fields: FieldMapping;          // Field name mappings
  transforms?: ValueTransforms;  // Value transformations
  priority?: number;             // Override default priority (0-3)
}

/**
 * Internal observation format (immutable)
 */
export interface InternalObservation {
  id: number;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string[];
  type: string;
  project: string;
  created_at_epoch: number;
  embedding?: number[];
  score?: number;  // Similarity score from vector search
}

/**
 * Schema Adapter class
 */
export class SchemaAdapter {
  private config: RemoteSchemaConfig;

  constructor(config: RemoteSchemaConfig) {
    this.config = config;
  }

  /**
   * Transform external record to internal format
   */
  transform(external: Record<string, unknown>): InternalObservation {
    const fields = this.config.fields;
    const transforms = this.config.transforms || {};

    return {
      id: this.extractNumber(external, fields.id || 'id'),
      title: this.extractString(external, fields.title || 'title'),
      subtitle: this.extractString(external, fields.subtitle || 'subtitle'),
      narrative: this.extractString(external, fields.narrative || 'narrative'),
      facts: this.extractArray(external, fields.facts || 'facts', transforms.facts),
      type: this.extractString(external, fields.type || 'type') || 'discovery',
      project: this.extractString(external, fields.project || 'project') || 'unknown',
      created_at_epoch: this.extractTimestamp(external, fields.timestamp || 'timestamp', transforms.timestamp),
      embedding: this.extractEmbedding(external, fields.embedding || 'embedding', transforms.embedding),
    };
  }

  /**
   * Transform batch of external records
   */
  transformBatch(externals: Record<string, unknown>[]): InternalObservation[] {
    return externals.map(ext => this.transform(ext));
  }

  private extractString(obj: Record<string, unknown>, field: string): string | null {
    const value = this.getNestedValue(obj, field);
    if (value === null || value === undefined) return null;
    return String(value);
  }

  private extractNumber(obj: Record<string, unknown>, field: string): number {
    const value = this.getNestedValue(obj, field);
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return parseInt(value, 10) || 0;
    return 0;
  }

  private extractTimestamp(
    obj: Record<string, unknown>,
    field: string,
    format?: TimestampFormat
  ): number {
    const value = this.getNestedValue(obj, field);
    if (value === null || value === undefined) return Date.now();

    switch (format) {
      case 'epoch_s':
      case 'unix':
        return (typeof value === 'number' ? value : parseInt(String(value), 10)) * 1000;
      case 'iso8601':
        return new Date(String(value)).getTime();
      case 'epoch_ms':
      default:
        return typeof value === 'number' ? value : parseInt(String(value), 10);
    }
  }

  private extractArray(
    obj: Record<string, unknown>,
    field: string,
    format?: ArrayFormat
  ): string[] {
    const value = this.getNestedValue(obj, field);
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.map(String);

    switch (format) {
      case 'csv':
        return String(value).split(',').map(s => s.trim());
      case 'json':
        try {
          const parsed = JSON.parse(String(value));
          return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch {
          return [];
        }
      default:
        return [];
    }
  }

  private extractEmbedding(
    obj: Record<string, unknown>,
    field: string,
    format?: EmbeddingFormat
  ): number[] | undefined {
    const value = this.getNestedValue(obj, field);
    if (value === null || value === undefined) return undefined;

    switch (format) {
      case 'base64':
        return this.base64ToFloatArray(String(value));
      case 'json_array':
        try {
          const parsed = JSON.parse(String(value));
          return Array.isArray(parsed) ? parsed.map(Number) : undefined;
        } catch {
          return undefined;
        }
      case 'binary':
        // Binary format would need special handling
        return undefined;
      case 'array':
      default:
        return Array.isArray(value) ? value.map(Number) : undefined;
    }
  }

  private base64ToFloatArray(base64: string): number[] {
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const floats = new Float32Array(bytes.buffer);
      return Array.from(floats);
    } catch {
      return [];
    }
  }

  /**
   * Get nested value using dot notation (e.g., "metadata.timestamp")
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    return path.split('.').reduce((current: unknown, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, obj);
  }

  /**
   * Get adapter config
   */
  getConfig(): RemoteSchemaConfig {
    return this.config;
  }

  /**
   * Get priority for this remote (for federation weighting)
   */
  getPriority(): number {
    return this.config.priority ?? -1;  // -1 means use default
  }
}

/**
 * Registry of schema adapters
 */
export class SchemaAdapterRegistry {
  private adapters: Map<string, SchemaAdapter> = new Map();

  register(config: RemoteSchemaConfig): void {
    this.adapters.set(config.id, new SchemaAdapter(config));
  }

  get(id: string): SchemaAdapter | undefined {
    return this.adapters.get(id);
  }

  remove(id: string): boolean {
    return this.adapters.delete(id);
  }

  list(): RemoteSchemaConfig[] {
    return Array.from(this.adapters.values()).map(a => a.getConfig());
  }

  /**
   * Create default adapter for claude-mem compatible remotes
   */
  static createDefaultAdapter(id: string, url: string): RemoteSchemaConfig {
    return {
      id,
      name: `Remote: ${id}`,
      url,
      fields: {
        id: 'id',
        title: 'title',
        subtitle: 'subtitle',
        narrative: 'narrative',
        facts: 'facts',
        type: 'type',
        project: 'project',
        timestamp: 'created_at_epoch',
        embedding: 'embedding',
      },
      transforms: {
        timestamp: 'epoch_ms',
        embedding: 'array',
        facts: 'json',
      },
    };
  }
}
