import pgPromise from "pg-promise";
import { isDevelopment } from "./config";

const pgp = pgPromise();

/**
 * Format SQL with positional $n parameters for debug logging using pg-promise.
 * Embedding vectors (long bracket arrays) are masked as <embedding>.
 */
export function interpolateSql(sql: string, params: any[]): string {
  const masked = isDevelopment() ? params : params.map(v => {
    if (typeof v === 'string' && v.startsWith('[') && v.length > 80) return '<embedding>';
    return v;
  });
  return pgp.as.format(sql, masked).replace(/\s+/g, ' ').trim();
}
