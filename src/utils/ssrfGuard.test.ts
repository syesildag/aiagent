import dns from 'dns';
import http from 'http';
import { AddressInfo } from 'net';
import { config } from './config';
import { assertPublicUrl, BlockedDestinationError, isPrivateAddress, safeFetch } from './ssrfGuard';

const mutableConfig = config as { FETCH_ALLOW_PRIVATE_NETWORKS: boolean };

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:a9fe:a9fe',
    'not-an-ip',
  ])('treats %s as private', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  it.each(['93.184.216.34', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('treats %s as public', (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  afterEach(() => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = false;
    jest.restoreAllMocks();
  });

  it.each([
    'file:///etc/passwd',
    'ftp://example.com/',
    'gopher://127.0.0.1:6379/_INFO',
    'javascript:alert(1)',
  ])('rejects non-http(s) scheme %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it.each([
    'http://127.0.0.1:5432/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',   // decimal 127.0.0.1
    'http://0x7f.1/',       // hex 127.0.0.1
    'http://localhost:11434/api/tags',
  ])('rejects private destination %s', async (url) => {
    await expect(assertPublicUrl(url)).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('rejects URLs with embedded credentials', async () => {
    await expect(assertPublicUrl('https://user:pass@example.com/')).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('rejects a hostname that resolves to a private address', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '10.0.0.5', family: 4 }] as never);
    await expect(assertPublicUrl('https://internal.example/')).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('accepts a hostname that resolves only to public addresses', async () => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    await expect(assertPublicUrl('https://example.com/page')).resolves.toBeInstanceOf(URL);
  });

  it('allows private destinations when FETCH_ALLOW_PRIVATE_NETWORKS is enabled', async () => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = true;
    await expect(assertPublicUrl('http://127.0.0.1:8080/')).resolves.toBeInstanceOf(URL);
  });
});

describe('safeFetch', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/redirect-file') {
        res.writeHead(302, { Location: 'file:///etc/passwd' }).end();
      } else if (req.url === '/big') {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('x'.repeat(2048));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' }).end('<p>hello</p>');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(() => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = false;
    jest.restoreAllMocks();
  });

  it('refuses to fetch a loopback service', async () => {
    await expect(safeFetch(`${baseUrl}/`)).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('fetches when private networks are explicitly allowed', async () => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = true;
    const res = await safeFetch(`${baseUrl}/`);
    expect(res.ok).toBe(true);
    expect(res.body).toBe('<p>hello</p>');
  });

  it('re-validates redirect targets', async () => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = true;
    await expect(safeFetch(`${baseUrl}/redirect-file`)).rejects.toBeInstanceOf(BlockedDestinationError);
  });

  it('enforces the response size limit', async () => {
    mutableConfig.FETCH_ALLOW_PRIVATE_NETWORKS = true;
    await expect(safeFetch(`${baseUrl}/big`, { maxBytes: 1024 })).rejects.toThrow(/exceeds 1024 bytes/);
  });

  it('blocks DNS rebinding: the connection address is checked, not just the first lookup', async () => {
    const port = (server.address() as AddressInfo).port;
    // Validation sees a public address…
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }] as never);
    // …but the lookup used for the actual connection returns loopback.
    jest.spyOn(dns, 'lookup').mockImplementation(((_host: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
      cb(null, [{ address: '127.0.0.1', family: 4 }]);
    }) as never);
    await expect(safeFetch(`http://rebind.example:${port}/`)).rejects.toBeInstanceOf(BlockedDestinationError);
  });
});
