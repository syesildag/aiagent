/**
 * Minimal Okapi BM25 index for ranking documents by relevance to a query.
 * Used as a CPU-lightweight alternative to neural embedding similarity for
 * skill and MCP server routing.
 *
 * Standard parameters: k1 = 1.5, b = 0.75.
 * No external dependencies — pure TypeScript arithmetic.
 */

function tokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
}

function buildIDF(tokenizedDocs: string[][], N: number): Map<string, number> {
  const df = new Map<string, number>();
  for (const doc of tokenizedDocs) {
    for (const term of new Set(doc)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }
  const idf = new Map<string, number>();
  for (const [term, freq] of df) {
    // BM25 IDF: log((N - df + 0.5) / (df + 0.5) + 1)
    idf.set(term, Math.log((N - freq + 0.5) / (freq + 0.5) + 1));
  }
  return idf;
}

export class BM25Index {
  private readonly k1: number;
  private readonly b: number;
  private readonly tokenizedDocs: string[][];
  private readonly idf: Map<string, number>;
  private readonly avgdl: number;

  constructor(documents: string[], k1 = 1.5, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    this.tokenizedDocs = documents.map(tokenize);
    this.avgdl =
      this.tokenizedDocs.reduce((sum, d) => sum + d.length, 0) /
      Math.max(this.tokenizedDocs.length, 1);
    this.idf = buildIDF(this.tokenizedDocs, documents.length);
  }

  /** Returns a raw BM25 score for each document. Higher = more relevant. */
  scoreAll(query: string): number[] {
    const queryTokens = tokenize(query);
    return this.tokenizedDocs.map(doc => this.scoreDoc(queryTokens, doc));
  }

  /**
   * Returns BM25 scores normalized to [0, 1] by dividing by the maximum score.
   * Returns all zeros when no document matches the query.
   */
  normalizedScoreAll(query: string): number[] {
    const scores = this.scoreAll(query);
    const max = Math.max(...scores, 0);
    if (max === 0) return scores.map(() => 0);
    return scores.map(s => s / max);
  }

  /**
   * Score a document string against a query string using the stored corpus IDF
   * weights. Pass the same string for both arguments to get the self-similarity
   * ceiling — useful for normalization independent of what other documents exist.
   */
  scoreAgainstQuery(query: string, doc: string): number {
    return this.scoreDoc(tokenize(query), tokenize(doc));
  }

  private scoreDoc(queryTokens: string[], doc: string[]): number {
    const tf = new Map<string, number>();
    for (const token of doc) {
      tf.set(token, (tf.get(token) ?? 0) + 1);
    }
    let score = 0;
    const dl = doc.length;
    for (const term of queryTokens) {
      const idf = this.idf.get(term) ?? 0;
      if (idf === 0) continue;
      const termFreq = tf.get(term) ?? 0;
      const numerator = termFreq * (this.k1 + 1);
      const denominator =
        termFreq + this.k1 * (1 - this.b + this.b * (dl / this.avgdl));
      score += idf * (numerator / denominator);
    }
    return score;
  }
}
