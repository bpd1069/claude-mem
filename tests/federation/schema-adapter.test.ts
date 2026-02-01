/**
 * SchemaAdapter Tests
 *
 * Tests for federation schema transformation functionality.
 */

import { describe, test, expect } from 'bun:test';
import {
  SchemaAdapter,
  SchemaAdapterRegistry,
  type RemoteSchemaConfig,
} from '../../src/services/federation/SchemaAdapter';

describe('SchemaAdapter', () => {
  describe('basic field mapping', () => {
    test('maps fields with default names', () => {
      const config: RemoteSchemaConfig = {
        id: 'test',
        name: 'Test Adapter',
        url: 'https://test.com',
        fields: {},
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        id: 123,
        title: 'Test Title',
        subtitle: 'Test Subtitle',
        narrative: 'Test narrative content',
        type: 'discovery',
        project: 'test-project',
        timestamp: 1706800000000,
      });

      expect(result.id).toBe(123);
      expect(result.title).toBe('Test Title');
      expect(result.subtitle).toBe('Test Subtitle');
      expect(result.narrative).toBe('Test narrative content');
      expect(result.type).toBe('discovery');
      expect(result.project).toBe('test-project');
      expect(result.created_at_epoch).toBe(1706800000000);
    });

    test('maps fields with custom names', () => {
      const config: RemoteSchemaConfig = {
        id: 'custom',
        name: 'Custom Adapter',
        url: 'https://custom.com',
        fields: {
          id: 'observation_id',
          title: 'summary',
          narrative: 'content',
          type: 'category',
          project: 'repo_name',
          timestamp: 'created_at',
        },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        observation_id: 456,
        summary: 'Custom Title',
        content: 'Custom content here',
        category: 'bugfix',
        repo_name: 'my-project',
        created_at: 1706900000000,
      });

      expect(result.id).toBe(456);
      expect(result.title).toBe('Custom Title');
      expect(result.narrative).toBe('Custom content here');
      expect(result.type).toBe('bugfix');
      expect(result.project).toBe('my-project');
      expect(result.created_at_epoch).toBe(1706900000000);
    });
  });

  describe('dot notation for nested fields', () => {
    test('extracts nested field values', () => {
      const config: RemoteSchemaConfig = {
        id: 'nested',
        name: 'Nested Adapter',
        url: 'https://nested.com',
        fields: {
          id: 'data.id',
          title: 'data.info.title',
          timestamp: 'metadata.timestamps.created',
        },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        data: {
          id: 789,
          info: {
            title: 'Nested Title',
          },
        },
        metadata: {
          timestamps: {
            created: 1707000000000,
          },
        },
      });

      expect(result.id).toBe(789);
      expect(result.title).toBe('Nested Title');
      expect(result.created_at_epoch).toBe(1707000000000);
    });

    test('handles missing nested paths gracefully', () => {
      const config: RemoteSchemaConfig = {
        id: 'missing',
        name: 'Missing Adapter',
        url: 'https://missing.com',
        fields: {
          title: 'data.missing.path',
        },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        data: {},
      });

      expect(result.title).toBeNull();
    });
  });

  describe('timestamp transforms', () => {
    test('converts epoch_ms (default)', () => {
      const config: RemoteSchemaConfig = {
        id: 'ts-ms',
        name: 'Timestamp MS',
        url: 'https://ts.com',
        fields: { timestamp: 'ts' },
        transforms: { timestamp: 'epoch_ms' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({ ts: 1707000000000 });
      expect(result.created_at_epoch).toBe(1707000000000);
    });

    test('converts epoch_s to epoch_ms', () => {
      const config: RemoteSchemaConfig = {
        id: 'ts-s',
        name: 'Timestamp Seconds',
        url: 'https://ts.com',
        fields: { timestamp: 'ts' },
        transforms: { timestamp: 'epoch_s' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({ ts: 1707000000 });
      expect(result.created_at_epoch).toBe(1707000000000);
    });

    test('converts iso8601 to epoch_ms', () => {
      const config: RemoteSchemaConfig = {
        id: 'ts-iso',
        name: 'Timestamp ISO',
        url: 'https://ts.com',
        fields: { timestamp: 'ts' },
        transforms: { timestamp: 'iso8601' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({ ts: '2024-02-04T00:00:00.000Z' });
      expect(result.created_at_epoch).toBe(new Date('2024-02-04T00:00:00.000Z').getTime());
    });
  });

  describe('array transforms', () => {
    test('handles native array', () => {
      const config: RemoteSchemaConfig = {
        id: 'arr',
        name: 'Array Adapter',
        url: 'https://arr.com',
        fields: { facts: 'facts' },
        transforms: { facts: 'array' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        facts: ['fact1', 'fact2', 'fact3'],
      });

      expect(result.facts).toEqual(['fact1', 'fact2', 'fact3']);
    });

    test('parses JSON array string', () => {
      const config: RemoteSchemaConfig = {
        id: 'json-arr',
        name: 'JSON Array Adapter',
        url: 'https://json.com',
        fields: { facts: 'facts' },
        transforms: { facts: 'json' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        facts: '["fact1", "fact2"]',
      });

      expect(result.facts).toEqual(['fact1', 'fact2']);
    });

    test('parses CSV string', () => {
      const config: RemoteSchemaConfig = {
        id: 'csv',
        name: 'CSV Adapter',
        url: 'https://csv.com',
        fields: { facts: 'facts' },
        transforms: { facts: 'csv' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        facts: 'fact1, fact2, fact3',
      });

      expect(result.facts).toEqual(['fact1', 'fact2', 'fact3']);
    });
  });

  describe('embedding transforms', () => {
    test('handles native float array', () => {
      const config: RemoteSchemaConfig = {
        id: 'emb-arr',
        name: 'Embedding Array',
        url: 'https://emb.com',
        fields: { embedding: 'vector' },
        transforms: { embedding: 'array' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        vector: [0.1, 0.2, 0.3, 0.4],
      });

      expect(result.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    test('parses JSON array embedding', () => {
      const config: RemoteSchemaConfig = {
        id: 'emb-json',
        name: 'Embedding JSON',
        url: 'https://emb.com',
        fields: { embedding: 'vector' },
        transforms: { embedding: 'json_array' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({
        vector: '[0.1, 0.2, 0.3]',
      });

      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    });

    test('handles missing embedding gracefully', () => {
      const config: RemoteSchemaConfig = {
        id: 'emb-missing',
        name: 'Embedding Missing',
        url: 'https://emb.com',
        fields: { embedding: 'vector' },
      };
      const adapter = new SchemaAdapter(config);

      const result = adapter.transform({});

      expect(result.embedding).toBeUndefined();
    });
  });

  describe('batch transformation', () => {
    test('transforms multiple records', () => {
      const config: RemoteSchemaConfig = {
        id: 'batch',
        name: 'Batch Adapter',
        url: 'https://batch.com',
        fields: {
          id: 'obs_id',
          title: 'name',
        },
      };
      const adapter = new SchemaAdapter(config);

      const results = adapter.transformBatch([
        { obs_id: 1, name: 'First' },
        { obs_id: 2, name: 'Second' },
        { obs_id: 3, name: 'Third' },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe(1);
      expect(results[0].title).toBe('First');
      expect(results[2].id).toBe(3);
      expect(results[2].title).toBe('Third');
    });
  });

  describe('defaults and fallbacks', () => {
    test('provides default type when missing', () => {
      const adapter = new SchemaAdapter({
        id: 'default',
        name: 'Default',
        url: 'https://default.com',
        fields: {},
      });

      const result = adapter.transform({});

      expect(result.type).toBe('discovery');
    });

    test('provides default project when missing', () => {
      const adapter = new SchemaAdapter({
        id: 'default',
        name: 'Default',
        url: 'https://default.com',
        fields: {},
      });

      const result = adapter.transform({});

      expect(result.project).toBe('unknown');
    });

    test('provides current timestamp when missing', () => {
      const adapter = new SchemaAdapter({
        id: 'default',
        name: 'Default',
        url: 'https://default.com',
        fields: {},
      });

      const before = Date.now();
      const result = adapter.transform({});
      const after = Date.now();

      expect(result.created_at_epoch).toBeGreaterThanOrEqual(before);
      expect(result.created_at_epoch).toBeLessThanOrEqual(after);
    });
  });
});

describe('SchemaAdapterRegistry', () => {
  test('registers and retrieves adapters', () => {
    const registry = new SchemaAdapterRegistry();

    registry.register({
      id: 'test-1',
      name: 'Test One',
      url: 'https://one.com',
      fields: {},
    });

    const adapter = registry.get('test-1');
    expect(adapter).toBeDefined();
    expect(adapter?.getConfig().name).toBe('Test One');
  });

  test('removes adapters', () => {
    const registry = new SchemaAdapterRegistry();

    registry.register({
      id: 'removable',
      name: 'Removable',
      url: 'https://remove.com',
      fields: {},
    });

    expect(registry.get('removable')).toBeDefined();

    const removed = registry.remove('removable');
    expect(removed).toBe(true);
    expect(registry.get('removable')).toBeUndefined();
  });

  test('lists all registered adapters', () => {
    const registry = new SchemaAdapterRegistry();

    registry.register({ id: 'a', name: 'A', url: 'https://a.com', fields: {} });
    registry.register({ id: 'b', name: 'B', url: 'https://b.com', fields: {} });
    registry.register({ id: 'c', name: 'C', url: 'https://c.com', fields: {} });

    const list = registry.list();
    expect(list).toHaveLength(3);
    expect(list.map(c => c.id).sort()).toEqual(['a', 'b', 'c']);
  });

  test('creates default adapter for claude-mem compatible DBs', () => {
    const config = SchemaAdapterRegistry.createDefaultAdapter('team', 'https://team.com');

    expect(config.id).toBe('team');
    expect(config.fields.id).toBe('id');
    expect(config.fields.title).toBe('title');
    expect(config.fields.timestamp).toBe('created_at_epoch');
    expect(config.transforms?.timestamp).toBe('epoch_ms');
  });
});

describe('Federation constants integration', () => {
  test('adapter priority respects federation limits', async () => {
    const { MAX_FEDERATION_REMOTES, validateFederationConfig } = await import(
      '../../src/constants/federation'
    );

    const registry = new SchemaAdapterRegistry();

    // Register max allowed
    for (let i = 0; i < MAX_FEDERATION_REMOTES; i++) {
      registry.register({
        id: `remote-${i}`,
        name: `Remote ${i}`,
        url: `https://remote${i}.com`,
        fields: {},
        priority: i + 1,
      });
    }

    expect(registry.list()).toHaveLength(3);

    // Validate count
    const validation = validateFederationConfig(registry.list().length);
    expect(validation.valid).toBe(true);

    // Exceeding limit should fail validation
    const overLimit = validateFederationConfig(4);
    expect(overLimit.valid).toBe(false);
    expect(overLimit.error).toContain('Maximum 3');
  });

  test('priority weights apply to adapters', async () => {
    const { getPriorityWeight } = await import('../../src/constants/federation');

    const adapters = [
      new SchemaAdapter({ id: 'r1', name: 'R1', url: 'https://r1.com', fields: {}, priority: 1 }),
      new SchemaAdapter({ id: 'r2', name: 'R2', url: 'https://r2.com', fields: {}, priority: 2 }),
      new SchemaAdapter({ id: 'r3', name: 'R3', url: 'https://r3.com', fields: {}, priority: 3 }),
    ];

    // Verify priorities match expected weights
    expect(getPriorityWeight(adapters[0].getPriority())).toBeCloseTo(0.618, 2);
    expect(getPriorityWeight(adapters[1].getPriority())).toBeCloseTo(0.382, 2);
    expect(getPriorityWeight(adapters[2].getPriority())).toBeCloseTo(0.236, 2);
  });
});
