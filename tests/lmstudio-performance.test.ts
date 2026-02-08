/**
 * LM Studio performance tests
 * Tests max_tokens cap and tool content truncation
 */

import { describe, it, expect } from 'bun:test';
import { buildObservationPrompt, truncateForPrompt } from '../src/sdk/prompts.js';

describe('truncateForPrompt', () => {
  it('passes small content through unchanged', () => {
    const small = 'a'.repeat(100);
    expect(truncateForPrompt(small)).toBe(small);
  });

  it('passes content at exactly the limit unchanged', () => {
    const exact = 'x'.repeat(4000);
    expect(truncateForPrompt(exact)).toBe(exact);
  });

  it('truncates content over the limit', () => {
    const large = 'b'.repeat(10000);
    const result = truncateForPrompt(large);
    expect(result.length).toBeLessThan(large.length);
    expect(result.length).toBeLessThan(5000);
  });

  it('includes truncation marker', () => {
    const large = 'c'.repeat(10000);
    const result = truncateForPrompt(large);
    expect(result).toContain('[TRUNCATED');
    expect(result).toContain('10000 chars');
  });

  it('respects custom max parameter', () => {
    const content = 'd'.repeat(500);
    const result = truncateForPrompt(content, 200);
    expect(result.length).toBeLessThan(500);
    expect(result).toContain('[TRUNCATED');
  });
});

describe('buildObservationPrompt truncation', () => {
  it('truncates large tool_output', () => {
    const largeOutput = JSON.stringify({ content: 'x'.repeat(10000) });
    const prompt = buildObservationPrompt({
      id: 0,
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/tmp/test.ts' }),
      tool_output: largeOutput,
      created_at_epoch: Date.now(),
    });
    expect(prompt.length).toBeLessThan(10000);
    expect(prompt).toContain('[TRUNCATED');
  });

  it('truncates large tool_input', () => {
    const largeInput = JSON.stringify({ query: 'y'.repeat(10000) });
    const prompt = buildObservationPrompt({
      id: 0,
      tool_name: 'Grep',
      tool_input: largeInput,
      tool_output: JSON.stringify({ matches: [] }),
      created_at_epoch: Date.now(),
    });
    expect(prompt).toContain('[TRUNCATED');
  });

  it('preserves XML structure around truncated content', () => {
    const largeOutput = JSON.stringify({ data: 'z'.repeat(10000) });
    const prompt = buildObservationPrompt({
      id: 0,
      tool_name: 'Read',
      tool_input: JSON.stringify({ file_path: '/tmp/test.ts' }),
      tool_output: largeOutput,
      created_at_epoch: Date.now(),
    });
    expect(prompt).toContain('<observed_from_primary_session>');
    expect(prompt).toContain('</observed_from_primary_session>');
    expect(prompt).toContain('<parameters>');
    expect(prompt).toContain('</parameters>');
    expect(prompt).toContain('<outcome>');
    expect(prompt).toContain('</outcome>');
  });

  it('does not truncate small tool output', () => {
    const smallOutput = JSON.stringify({ result: 'ok' });
    const prompt = buildObservationPrompt({
      id: 0,
      tool_name: 'Bash',
      tool_input: JSON.stringify({ command: 'echo hi' }),
      tool_output: smallOutput,
      created_at_epoch: Date.now(),
    });
    expect(prompt).not.toContain('[TRUNCATED');
  });
});
