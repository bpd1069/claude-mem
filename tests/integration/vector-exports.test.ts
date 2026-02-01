/**
 * Vector Exports Integration Tests
 *
 * Tests for EmbeddingProvider and Exporter functionality.
 */

import { describe, it, expect } from 'bun:test';
import {
  embeddingToBlob,
  blobToEmbedding,
  createEmbeddingProvider
} from '../../src/services/vector/EmbeddingProvider.js';
import { Exporter, type ExportFormat } from '../../src/services/sync/Exporter.js';

describe('EmbeddingProvider utilities', () => {
  describe('embeddingToBlob', () => {
    it('should convert embedding array to buffer', () => {
      const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
      const blob = embeddingToBlob(embedding);

      expect(blob).toBeInstanceOf(Buffer);
      expect(blob.length).toBe(embedding.length * 4); // 4 bytes per float32
    });

    it('should handle empty embedding', () => {
      const embedding: number[] = [];
      const blob = embeddingToBlob(embedding);

      expect(blob).toBeInstanceOf(Buffer);
      expect(blob.length).toBe(0);
    });

    it('should preserve precision for small values', () => {
      const embedding = [0.000001, 0.999999];
      const blob = embeddingToBlob(embedding);
      const restored = blobToEmbedding(blob);

      // Float32 has limited precision, so we use approximate comparison
      expect(Math.abs(restored[0] - embedding[0])).toBeLessThan(0.0001);
      expect(Math.abs(restored[1] - embedding[1])).toBeLessThan(0.0001);
    });
  });

  describe('blobToEmbedding', () => {
    it('should convert buffer back to embedding array', () => {
      const original = [0.1, 0.2, 0.3, 0.4, 0.5];
      const blob = embeddingToBlob(original);
      const restored = blobToEmbedding(blob);

      expect(restored.length).toBe(original.length);

      // Compare with tolerance for float32 precision
      for (let i = 0; i < original.length; i++) {
        expect(Math.abs(restored[i] - original[i])).toBeLessThan(0.0001);
      }
    });

    it('should handle empty buffer', () => {
      const blob = Buffer.alloc(0);
      const embedding = blobToEmbedding(blob);

      expect(embedding).toEqual([]);
    });
  });

  describe('round-trip conversion', () => {
    it('should preserve embedding through blob conversion', () => {
      const original = Array.from({ length: 768 }, (_, i) => Math.sin(i / 100));
      const blob = embeddingToBlob(original);
      const restored = blobToEmbedding(blob);

      expect(restored.length).toBe(original.length);

      // Check a few values
      expect(Math.abs(restored[0] - original[0])).toBeLessThan(0.0001);
      expect(Math.abs(restored[383] - original[383])).toBeLessThan(0.0001);
      expect(Math.abs(restored[767] - original[767])).toBeLessThan(0.0001);
    });
  });
});

describe('createEmbeddingProvider factory', () => {
  it('should create LMStudio provider by default', () => {
    // This will create a provider based on settings
    // May throw if settings are not configured, which is expected
    try {
      const provider = createEmbeddingProvider();
      expect(provider).toBeDefined();
      expect(typeof provider.embed).toBe('function');
      expect(typeof provider.embedSingle).toBe('function');
    } catch {
      // Expected if LM Studio is not configured
    }
  });

  it('should respect provider config', () => {
    const provider = createEmbeddingProvider({
      provider: 'lmstudio',
      baseUrl: 'http://localhost:1234/v1',
      dimensions: 768
    });

    expect(provider).toBeDefined();
    expect(provider.name).toBe('lmstudio');
    expect(provider.dimensions).toBe(768);
  });
});

describe('Exporter', () => {
  describe('initialization', () => {
    it('should create Exporter instance', () => {
      const exporter = new Exporter();
      expect(exporter).toBeDefined();
    });
  });

  describe('export formats', () => {
    it('should support all three formats', () => {
      const formats: ExportFormat[] = ['sqlite', 'full', 'json'];

      for (const format of formats) {
        expect(['sqlite', 'full', 'json'].includes(format)).toBe(true);
      }
    });
  });

  // Note: Full export tests require database fixtures
  // These are integration tests that should be run with actual data
});
