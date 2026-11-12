/** The local XMLTV copy is refreshed once it is older than this. */
export const XMLTV_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** After a refresh has started, wait this long before starting another one. */
export const XMLTV_RETRY_AFTER_MS = 60 * 60 * 1000;

/** True when the copy was downloaded more than `maxAgeMs` ago. */
export function isXmltvStale(
  downloadedAtMs: number,
  nowMs: number,
  maxAgeMs: number = XMLTV_MAX_AGE_MS,
): boolean {
  return nowMs - downloadedAtMs > maxAgeMs;
}
