import { BM25Index } from './bm25Index';

describe('BM25Index', () => {
  const docs = [
    'get current weather forecast temperature rain wind',
    'list all scheduled jobs task cron status enabled',
    'send email message outlook calendar meeting invite',
    'search web news articles fetch browse url link',
  ];

  let index: BM25Index;

  beforeEach(() => {
    index = new BM25Index(docs);
  });

  it('returns a scores array matching document count', () => {
    expect(index.scoreAll('weather')).toHaveLength(docs.length);
    expect(index.normalizedScoreAll('weather')).toHaveLength(docs.length);
  });

  it('scores the weather document highest for a weather query', () => {
    const scores = index.scoreAll('weather forecast');
    const maxIdx = scores.indexOf(Math.max(...scores));
    expect(maxIdx).toBe(0);
  });

  it('scores the jobs document highest for a jobs query', () => {
    const scores = index.scoreAll('list jobs scheduled');
    const maxIdx = scores.indexOf(Math.max(...scores));
    expect(maxIdx).toBe(1);
  });

  it('scores the email document highest for an email query', () => {
    const scores = index.scoreAll('send email outlook calendar');
    const maxIdx = scores.indexOf(Math.max(...scores));
    expect(maxIdx).toBe(2);
  });

  it('normalizedScoreAll returns values in [0, 1]', () => {
    const scores = index.normalizedScoreAll('weather forecast');
    for (const s of scores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('normalizedScoreAll best match is exactly 1.0', () => {
    const scores = index.normalizedScoreAll('fetch browse url');
    expect(Math.max(...scores)).toBeCloseTo(1.0);
    expect(scores.indexOf(Math.max(...scores))).toBe(3);
  });

  it('returns all zeros for a query with no matching terms', () => {
    const scores = index.normalizedScoreAll('xyzzy foobar nonexistent');
    expect(scores.every(s => s === 0)).toBe(true);
  });

  it('handles an empty document list gracefully', () => {
    const empty = new BM25Index([]);
    expect(empty.scoreAll('weather')).toHaveLength(0);
    expect(empty.normalizedScoreAll('weather')).toHaveLength(0);
  });

  it('handles a single-document list', () => {
    const single = new BM25Index(['hello world']);
    const scores = single.normalizedScoreAll('hello');
    expect(scores).toHaveLength(1);
    expect(scores[0]).toBeCloseTo(1.0);
  });

  it('is case-insensitive', () => {
    const scoresLower = index.scoreAll('weather');
    const scoresUpper = index.scoreAll('WEATHER');
    scoresLower.forEach((s, i) => expect(s).toBeCloseTo(scoresUpper[i]));
  });

  it('ignores punctuation in query and documents', () => {
    const withPunct = new BM25Index(['weather! forecast, temperature.']);
    const scores = withPunct.scoreAll('weather forecast');
    expect(scores[0]).toBeGreaterThan(0);
  });
});
