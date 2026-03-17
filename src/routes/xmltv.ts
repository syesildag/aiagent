import { execFile } from 'child_process';
import { Request, Response, Router } from 'express';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { config } from '../utils/config';
import { asyncHandler } from '../utils/asyncHandler';

const execFileAsync = promisify(execFile);

async function findXmltvFile(dir: string): Promise<string | undefined> {
  const entries = await fs.promises.readdir(dir);
  const found = entries.find(e => e.toLowerCase().endsWith('.xml'));
  return found ? path.join(dir, found) : undefined;
}

async function ensureXmltvFile(xmltvDir: string): Promise<string> {
  // Try to find an existing file first
  let xmlFile = await findXmltvFile(xmltvDir);
  if (xmlFile) return xmlFile;

  // Not found — run the download script and try again
  const scriptPath = path.resolve(__dirname, '../../../scripts/download-xmltv.sh');
  await execFileAsync('bash', [scriptPath], { timeout: 300_000 });

  xmlFile = await findXmltvFile(xmltvDir);
  if (!xmlFile) throw new Error('Download completed but no .xml file found in XMLTV_PATH');
  return xmlFile;
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
      {
        src: '/static/icons/xmltv-icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  });
});

// Serve the compiled XMLTV viewer HTML (auth handled by the React app)
xmltvRouter.get('/xmltv', (_req: Request, res: Response) => {
  const htmlPath = path.resolve(__dirname, '../../templates/xmltv.html');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.sendFile(htmlPath);
});

// Return the raw XMLTV data — requires a valid session
xmltvRouter.post('/xmltv/data', asyncHandler(async (_req: Request, res: Response) => {
  if (!res.locals.session) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const xmltvDir = path.resolve(config.XMLTV_PATH);
  await fs.promises.mkdir(xmltvDir, { recursive: true });
  const xmlFile = await ensureXmltvFile(xmltvDir);

  const xml = await fs.promises.readFile(xmlFile, 'utf-8');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(xml);
}));
