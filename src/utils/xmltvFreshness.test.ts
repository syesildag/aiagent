import { isXmltvStale, XMLTV_MAX_AGE_MS } from './xmltvFreshness';

describe('isXmltvStale', () => {
  const now = Date.parse('2026-11-12T18:00:00Z');

  it('is fresh when downloaded within the last day', () => {
    expect(isXmltvStale(now - 2 * 60 * 60 * 1000, now)).toBe(false);
  });

  it('is stale once downloaded more than a day ago', () => {
    expect(isXmltvStale(now - XMLTV_MAX_AGE_MS - 1, now)).toBe(true);
  });

  it('is fresh exactly at the boundary', () => {
    expect(isXmltvStale(now - XMLTV_MAX_AGE_MS, now)).toBe(false);
  });

  it('is stale for a copy from months ago', () => {
    expect(isXmltvStale(Date.parse('2026-03-16T00:00:00Z'), now)).toBe(true);
  });
});
