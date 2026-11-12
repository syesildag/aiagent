import { execFile } from 'child_process';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { config } from '../utils/config';
import { asyncHandler } from '../utils/asyncHandler';
import Logger from '../utils/logger';
import { isXmltvStale, XMLTV_RETRY_AFTER_MS } from '../utils/xmltvFreshness';
import aiAgentPushSubscriptionRepository, { AiAgentPushSubscription } from '../entities/ai-agent-push-subscription';
import aiAgentScheduledPushNotificationRepository, { AiAgentScheduledPushNotification } from '../entities/ai-agent-scheduled-push-notification';

const execFileAsync = promisify(execFile);

async function findXmltvFile(dir: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(dir);
  const found = entries.find(e => e.toLowerCase().endsWith('.xml'));
  Logger.debug(`[xmltv] findXmltvFile dir=${dir} entries=${entries.length} found=${found ?? 'none'}`);
  return found ? path.join(dir, found) : undefined;
}

// At most one download runs at a time; concurrent guide requests share it.
let refreshInFlight: Promise<void> | null = null;
let lastRefreshAttemptMs = 0;

async function downloadXmltvFeed(xmltvDir: string): Promise<void> {
  // npm scripts and `npm start` both run from the project root, where the script lives.
  const scriptPath = path.resolve(process.cwd(), 'src/scripts/download-xmltv.sh');
  Logger.info(`[xmltv] Downloading XMLTV feed into ${xmltvDir}`);
  await execFileAsync('bash', [scriptPath], {
    timeout: 300_000,
    env: { ...process.env, XMLTV_PATH: xmltvDir },
  });
  // The zip keeps the feed's own timestamp. Stamp the file with the download time so the
  // age check measures time since the last download.
  const file = await findXmltvFile(xmltvDir);
  if (file) {
    const now = new Date();
    await fs.promises.utimes(file, now, now);
  }
}

function refreshXmltvFeed(xmltvDir: string): Promise<void> {
  if (!refreshInFlight) {
    lastRefreshAttemptMs = Date.now();
    refreshInFlight = downloadXmltvFeed(xmltvDir).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

async function ensureXmltvFile(xmltvDir: string): Promise<string> {
  const existing = await findXmltvFile(xmltvDir);

  if (existing) {
    const { mtimeMs } = await fs.promises.stat(existing);
    const now = Date.now();
    if (isXmltvStale(mtimeMs, now) && now - lastRefreshAttemptMs >= XMLTV_RETRY_AFTER_MS) {
      // Refresh in the background and serve the current copy meanwhile.
      refreshXmltvFeed(xmltvDir).catch(error => {
        Logger.warn(`[xmltv] Refresh failed, keeping the current copy: ${error instanceof Error ? error.message : String(error)}`);
      });
    }
    Logger.debug(`[xmltv] Using XMLTV file: ${existing}`);
    return existing;
  }

  // No copy yet, so this first load has to wait for the download.
  await refreshXmltvFeed(xmltvDir);
  const downloaded = await findXmltvFile(xmltvDir);
  if (!downloaded) throw new Error('Download completed but no .xml file found in XMLTV_PATH');
  Logger.debug(`[xmltv] Download complete, using: ${downloaded}`);
  return downloaded;
}

export const xmltvRouter = Router();

// Web app manifest for PWA "Add to Home Screen"
xmltvRouter.get('/xmltv/manifest.json', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json({
    name: 'XMLTV Guide',
    short_name: 'XMLTV',
    description: 'XMLTV Electronic Programme Guide',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0c0c10',
    theme_color: '#0c0c10',
    start_url: '/xmltv',
    scope: '/',
    icons: [
      { src: '/static/icons/xmltv-icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/static/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/static/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  });
});

// Serve the compiled XMLTV viewer HTML (auth handled by the React app)
xmltvRouter.get('/xmltv', (_req: Request, res: Response) => {
  const htmlPath = path.resolve(__dirname, '../../templates/xmltv.html');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(htmlPath);
});

// VAPID public key — lets the frontend subscribe to web push notifications
xmltvRouter.get('/xmltv/vapid-public-key', (_req: Request, res: Response) => {
  res.json({ publicKey: config.VAPID_PUBLIC_KEY ?? null });
});

// Store a push subscription (endpoint + keys) so the server can send pushes later
xmltvRouter.post('/xmltv/push-subscribe', asyncHandler(async (req: Request, res: Response) => {
  const { endpoint, p256dh, auth } = req.body ?? {};
  Logger.debug(`[xmltv] POST /xmltv/push-subscribe endpoint=${typeof endpoint === 'string' ? endpoint.slice(0, 60) + '…' : typeof endpoint}`);
  if (typeof endpoint !== 'string' || endpoint.length === 0 ||
      typeof p256dh  !== 'string' || p256dh.length  === 0 ||
      typeof auth    !== 'string' || auth.length    === 0) {
    Logger.debug('[xmltv] push-subscribe: invalid body');
    res.status(400).json({ error: 'endpoint, p256dh and auth must be non-empty strings' });
    return;
  }
  const existing = await aiAgentPushSubscriptionRepository.findByEndpoint(endpoint);
  const sub = new AiAgentPushSubscription({ id: existing?.getId(), endpoint, p256dh, auth });
  await sub.save();
  Logger.debug(`[xmltv] push-subscribe: ${existing ? 'updated' : 'saved new'} subscription`);
  res.json({ ok: true });
}));

// Schedule a push notification to fire at a specific future timestamp
xmltvRouter.post('/xmltv/push-schedule', asyncHandler(async (req: Request, res: Response) => {
  const { id, endpoint, title, body, icon, url, fireAt } = req.body ?? {};
  Logger.debug(`[xmltv] POST /xmltv/push-schedule id=${id} title=${title} fireAt=${fireAt}`);
  if (!id || !endpoint || !title || !body || !fireAt) {
    Logger.debug('[xmltv] push-schedule: missing required fields');
    res.status(400).json({ error: 'id, endpoint, title, body and fireAt are required' });
    return;
  }
  const fireAtDate = new Date(fireAt);
  if (isNaN(fireAtDate.getTime())) {
    Logger.debug(`[xmltv] push-schedule: invalid fireAt value: ${fireAt}`);
    res.status(400).json({ error: 'fireAt must be a valid ISO timestamp' });
    return;
  }
  const existing = await aiAgentScheduledPushNotificationRepository.getById(id);
  if (existing) {
    Logger.debug(`[xmltv] push-schedule: notification ${id} already scheduled, skipping`);
    res.json({ ok: true });
    return;
  }
  const n = new AiAgentScheduledPushNotification({ id, endpoint, title, body, icon, url, fireAt: fireAtDate });
  await n.save();
  Logger.debug(`[xmltv] push-schedule: saved notification ${id} for ${fireAtDate.toISOString()}`);
  res.json({ ok: true });
}));

// Cancel a previously scheduled push notification
xmltvRouter.delete('/xmltv/push-schedule/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  Logger.debug(`[xmltv] DELETE /xmltv/push-schedule/${id}`);
  const n = await aiAgentScheduledPushNotificationRepository.getById(id);
  if (n) {
    await n.delete();
    Logger.debug(`[xmltv] push-schedule: deleted notification ${id}`);
  } else {
    Logger.debug(`[xmltv] push-schedule: notification ${id} not found, nothing to delete`);
  }
  res.json({ ok: true });
}));

// Return the raw XMLTV data — requires a valid session
xmltvRouter.post('/xmltv/data', asyncHandler(async (_req: Request, res: Response) => {
  Logger.debug('[xmltv] POST /xmltv/data');
  if (!res.locals.session) {
    Logger.debug('[xmltv] /xmltv/data: unauthorized');
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const xmltvDir = path.resolve(config.XMLTV_PATH);
  Logger.debug(`[xmltv] /xmltv/data: resolved dir=${xmltvDir}`);
  await fs.promises.mkdir(xmltvDir, { recursive: true });
  const xmlFile = await ensureXmltvFile(xmltvDir);

  const xml = await fs.promises.readFile(xmlFile, 'utf-8');
  Logger.debug(`[xmltv] /xmltv/data: serving ${xmlFile} (${xml.length} bytes)`);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
}));
