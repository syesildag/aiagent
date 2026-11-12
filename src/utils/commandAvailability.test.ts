import { missingServers } from './commandAvailability';

describe('missingServers', () => {
  const enabled = new Set(['memory', 'jobs']);

  it('reports nothing for a command that names no server', () => {
    expect(missingServers(undefined, enabled)).toEqual([]);
    expect(missingServers([], enabled)).toEqual([]);
  });

  it('reports nothing when every named server is enabled', () => {
    expect(missingServers(['jobs'], enabled)).toEqual([]);
  });

  it('reports the named servers that are not enabled', () => {
    expect(missingServers(['jobs', 'outlook'], enabled)).toEqual(['outlook']);
  });

  it('treats the wildcard as needing no particular server', () => {
    expect(missingServers(['*'], new Set())).toEqual([]);
  });
});
