import { compressForHistory } from '../toolResultCompressor';

describe('compressForHistory', () => {
  it('strips pretty-print whitespace from JSON', () => {
    const prettyJson = JSON.stringify({ a: 1, b: 'hello' }, null, 2);
    const compressed = compressForHistory(prettyJson, 10_000);
    expect(compressed).toBe('{"a":1,"b":"hello"}');
  });

  it('prunes null fields', () => {
    const input = JSON.stringify({ a: 1, b: null, c: 'keep' }, null, 2);
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"a":1,"c":"keep"}');
  });

  it('prunes empty string fields', () => {
    const input = JSON.stringify({ a: 'hello', b: '', c: 3 });
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"a":"hello","c":3}');
  });

  it('prunes empty array fields', () => {
    const input = JSON.stringify({ items: [], count: 2, name: 'test' });
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"count":2,"name":"test"}');
  });

  it('prunes empty object fields', () => {
    const input = JSON.stringify({ meta: {}, value: 42 });
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"value":42}');
  });

  it('prunes null fields (inline JSON)', () => {
    const input = '{"a":1,"b":null,"c":"ok"}';
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"a":1,"c":"ok"}');
  });

  it('handles nested objects recursively', () => {
    const input = JSON.stringify({
      data: { name: 'Alice', empty: null, tags: [] },
      count: 1,
    }, null, 2);
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('{"data":{"name":"Alice"},"count":1}');
  });

  it('truncates at maxChars and appends marker', () => {
    const input = JSON.stringify({ content: 'x'.repeat(3000) });
    const result = compressForHistory(input, 500);
    expect(result.length).toBeLessThanOrEqual(500 + '...[history truncated]'.length);
    expect(result).toContain('[history truncated]');
  });

  it('returns content unchanged when under maxChars', () => {
    const input = JSON.stringify({ a: 1 });
    expect(compressForHistory(input, 10_000)).toBe('{"a":1}');
  });

  it('falls back to plain truncation for non-JSON strings (error messages)', () => {
    const errorStr = 'Error calling tool: connection refused';
    const result = compressForHistory(errorStr, 10_000);
    expect(result).toBe(errorStr);
  });

  it('truncates non-JSON strings that exceed maxChars', () => {
    const long = 'Error: ' + 'x'.repeat(2000);
    const result = compressForHistory(long, 100);
    expect(result.length).toBeLessThanOrEqual(100 + '...[history truncated]'.length);
    expect(result).toContain('[history truncated]');
  });

  it('preserves arrays of objects, pruning empty fields within each', () => {
    const input = JSON.stringify([
      { id: 1, name: 'Alice', extra: null },
      { id: 2, name: 'Bob', extra: '' },
    ]);
    const result = compressForHistory(input, 10_000);
    expect(result).toBe('[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]');
  });
});
