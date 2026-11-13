/**
 * SSRF protection for tools that fetch URLs chosen by the LLM.
 *
 * URLs reach the fetch and browser MCP servers from the model, which can be
 * steered by the user or by text inside a fetched page (prompt injection).
 * Without a guard the model could be made to read cloud metadata
 * (169.254.169.254), the database, Ollama, or other services that are only
 * reachable from this host.
 *
 * Set FETCH_ALLOW_PRIVATE_NETWORKS=true to allow private destinations (e.g.
 * a trusted home network).
 */
import dns from 'dns';
import http from 'http';
import https from 'https';
import net from 'net';
import zlib from 'zlib';
import { config } from './config';

/** Thrown when a URL or a resolved address is not allowed. */
export class BlockedDestinationError extends Error {
   constructor(message: string) {
      super(message);
      this.name = 'BlockedDestinationError';
   }
}

const BLOCKED_NETWORKS = new net.BlockList();
// IPv4 — RFC 6890 special-purpose ranges (IPv4-mapped IPv6 addresses match these too)
for (const [network, prefix] of [
   ['0.0.0.0', 8],        // "this" network
   ['10.0.0.0', 8],       // private
   ['100.64.0.0', 10],    // carrier-grade NAT
   ['127.0.0.0', 8],      // loopback
   ['169.254.0.0', 16],   // link-local, cloud metadata
   ['172.16.0.0', 12],    // private
   ['192.0.0.0', 24],     // IETF protocol assignments
   ['192.0.2.0', 24],     // TEST-NET-1
   ['192.88.99.0', 24],   // 6to4 relay anycast
   ['192.168.0.0', 16],   // private
   ['198.18.0.0', 15],    // benchmarking
   ['198.51.100.0', 24],  // TEST-NET-2
   ['203.0.113.0', 24],   // TEST-NET-3
   ['224.0.0.0', 4],      // multicast
   ['240.0.0.0', 4],      // reserved + broadcast
] as const) {
   BLOCKED_NETWORKS.addSubnet(network, prefix, 'ipv4');
}
// IPv6
for (const [network, prefix] of [
   ['::', 128],           // unspecified
   ['::1', 128],          // loopback
   ['64:ff9b::', 96],     // NAT64 (embeds IPv4)
   ['64:ff9b:1::', 48],   // local-use NAT64
   ['100::', 64],         // discard
   ['2001:db8::', 32],    // documentation
   ['2002::', 16],        // 6to4 (embeds IPv4)
   ['fc00::', 7],         // unique local
   ['fe80::', 10],        // link-local
   ['ff00::', 8],         // multicast
] as const) {
   BLOCKED_NETWORKS.addSubnet(network, prefix, 'ipv6');
}

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

function privateNetworksAllowed(): boolean {
   return config.FETCH_ALLOW_PRIVATE_NETWORKS === true;
}

/** True when `ip` is loopback, private, link-local, multicast or otherwise non-public. */
export function isPrivateAddress(ip: string): boolean {
   const family = net.isIP(ip);
   if (family === 4) return BLOCKED_NETWORKS.check(ip, 'ipv4');
   if (family === 6) return BLOCKED_NETWORKS.check(ip, 'ipv6');
   return true; // not an IP literal: never treat as public
}

function assertPublicAddress(hostname: string, address: string): void {
   if (!privateNetworksAllowed() && isPrivateAddress(address)) {
      throw new BlockedDestinationError(
         `Blocked request to ${hostname} (${address}): private, loopback and link-local addresses are not allowed`,
      );
   }
}

/** Strip the brackets WHATWG URL keeps around IPv6 hostnames. */
function bareHostname(url: URL): string {
   return url.hostname.replace(/^\[(.*)\]$/, '$1');
}

/**
 * Parse `rawUrl`, require http(s), resolve the host and make sure every
 * address it resolves to is public. Returns the parsed URL.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
   let url: URL;
   try {
      url = new URL(rawUrl);
   } catch {
      throw new BlockedDestinationError(`Invalid URL: ${rawUrl}`);
   }
   if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
      throw new BlockedDestinationError(`Blocked URL scheme "${url.protocol}": only http and https are allowed`);
   }
   if (url.username || url.password) {
      throw new BlockedDestinationError('URLs with embedded credentials are not allowed');
   }
   if (privateNetworksAllowed()) return url;

   const hostname = bareHostname(url);
   if (net.isIP(hostname)) {
      assertPublicAddress(hostname, hostname);
      return url;
   }
   let addresses: dns.LookupAddress[];
   try {
      addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
   } catch (err) {
      throw new BlockedDestinationError(`Could not resolve ${hostname}: ${err instanceof Error ? err.message : String(err)}`);
   }
   if (addresses.length === 0) {
      throw new BlockedDestinationError(`Could not resolve ${hostname}`);
   }
   for (const { address } of addresses) {
      assertPublicAddress(hostname, address);
   }
   return url;
}

/**
 * dns.lookup replacement for http(s).request that refuses private addresses.
 * Because the check runs on the address the socket actually connects to, a
 * DNS answer that changes between validation and connection (DNS rebinding)
 * cannot slip through.
 */
function guardedLookup(
   hostname: string,
   options: dns.LookupOptions,
   callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
   dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '');
      try {
         if (addresses.length === 0) throw new BlockedDestinationError(`Could not resolve ${hostname}`);
         for (const { address } of addresses) assertPublicAddress(hostname, address);
      } catch (guardErr) {
         return callback(guardErr as NodeJS.ErrnoException, '');
      }
      if (options.all) return callback(null, addresses);
      const [first] = addresses;
      callback(null, first.address, first.family);
   });
}

export interface SafeFetchOptions {
   headers?: Record<string, string>;
   timeoutMs?: number;
   /** Maximum decoded body size in bytes (default 5 MB). */
   maxBytes?: number;
   /** Maximum number of redirects to follow (default 5). */
   maxRedirects?: number;
}

export interface SafeFetchResponse {
   ok: boolean;
   status: number;
   statusText: string;
   headers: http.IncomingHttpHeaders;
   /** Final URL after redirects. */
   url: string;
   body: string;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function decodeBody(res: http.IncomingMessage): NodeJS.ReadableStream {
   switch ((res.headers['content-encoding'] ?? '').toLowerCase()) {
      case 'gzip':
      case 'x-gzip':
         return res.pipe(zlib.createGunzip());
      case 'deflate':
         return res.pipe(zlib.createInflate());
      case 'br':
         return res.pipe(zlib.createBrotliDecompress());
      default:
         return res;
   }
}

function requestOnce(url: URL, options: Required<Omit<SafeFetchOptions, 'maxRedirects'>>, deadline: number): Promise<{
   res: http.IncomingMessage; body?: string;
}> {
   return new Promise((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const remaining = Math.max(1, deadline - Date.now());
      let settled = false;
      // Settle exactly once; once the response has started, destroying the request
      // does not reach req's 'error' listener and 'end' may still fire.
      const fail = (err: Error): void => {
         if (!settled) {
            settled = true;
            reject(err);
         }
         req.destroy();
      };
      const req = transport.request(url, {
         method: 'GET',
         headers: { 'Accept-Encoding': 'gzip, deflate, br', ...options.headers },
         lookup: guardedLookup as unknown as net.LookupFunction,
         timeout: remaining,
      }, (res) => {
         if (REDIRECT_STATUSES.has(res.statusCode ?? 0) && res.headers.location) {
            res.resume();
            settled = true;
            resolve({ res });
            return;
         }
         const chunks: Uint8Array[] = [];
         let size = 0;
         const stream = decodeBody(res);
         res.on('error', fail);
         stream.on('error', fail);
         stream.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            if (size > options.maxBytes) {
               fail(new Error(`Response exceeds ${options.maxBytes} bytes`));
               return;
            }
            chunks.push(new Uint8Array(chunk));
         });
         stream.on('end', () => {
            if (settled) return;
            settled = true;
            resolve({ res, body: Buffer.concat(chunks).toString('utf-8') });
         });
      });
      req.on('timeout', () => fail(new Error(`Request timed out after ${options.timeoutMs}ms`)));
      req.on('error', fail);
      req.end();
   });
}

/**
 * GET a URL with SSRF protection: http(s) only, every hop (including
 * redirects) re-validated, and the connection pinned to a vetted address.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
   const resolved = {
      headers: options.headers ?? {},
      timeoutMs: options.timeoutMs ?? 10_000,
      maxBytes: options.maxBytes ?? 5 * 1024 * 1024,
   };
   const maxRedirects = options.maxRedirects ?? 5;
   const deadline = Date.now() + resolved.timeoutMs;

   let url = await assertPublicUrl(rawUrl);
   for (let hop = 0; ; hop++) {
      const { res, body } = await requestOnce(url, resolved, deadline);
      if (body === undefined) {
         if (hop >= maxRedirects) throw new Error(`Too many redirects (>${maxRedirects})`);
         url = await assertPublicUrl(new URL(res.headers.location!, url).toString());
         continue;
      }
      const status = res.statusCode ?? 0;
      return {
         ok: status >= 200 && status < 300,
         status,
         statusText: res.statusMessage ?? '',
         headers: res.headers,
         url: url.toString(),
         body,
      };
   }
}
