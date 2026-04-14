// export-slides.mjs — Playwright script to export HTML slides to PDF
//
// How it works:
// 1. Starts a local HTTP server (needed for fonts/assets to load)
// 2. Opens the presentation in a headless browser at 1920x1080
// 3. Counts the total number of slides
// 4. Screenshots each slide one by one
// 5. Generates a PDF with all slides as landscape pages

import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFileSync, mkdirSync, unlinkSync } from 'fs';
import { join, extname } from 'path';

const SERVE_DIR = process.argv[2];
const HTML_FILE = process.argv[3];
const OUTPUT_PDF = process.argv[4];
const SCREENSHOT_DIR = process.argv[5];
const VP_WIDTH = parseInt(process.argv[6]) || 1920;
const VP_HEIGHT = parseInt(process.argv[7]) || 1080;

// ─── Simple static file server ────────────────────────────
// (We need HTTP so that Google Fonts and relative assets load correctly)

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
};

const server = createServer((req, res) => {
  // Decode URL-encoded characters (e.g., %20 → space) so filenames with spaces resolve correctly
  const decodedUrl = decodeURIComponent(req.url);
  let filePath = join(SERVE_DIR, decodedUrl === '/' ? HTML_FILE : decodedUrl);
  try {
    const content = readFileSync(filePath);
    const ext = extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

// Find a free port
const port = await new Promise((resolve) => {
  server.listen(0, () => resolve(server.address().port));
});

console.log(`  Local server on port ${port}`);

// ─── Screenshot each slide ────────────────────────────────

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: VP_WIDTH, height: VP_HEIGHT },
});

// Load the presentation
await page.goto(`http://localhost:${port}/`, { waitUntil: 'networkidle' });

// Wait for fonts to load
await page.evaluate(() => document.fonts.ready);

// Extra wait for animations to settle on the first slide
await page.waitForTimeout(1500);

// Count slides
const slideCount = await page.evaluate(() => {
  return document.querySelectorAll('.slide').length;
});

console.log(`  Found ${slideCount} slides`);

if (slideCount === 0) {
  console.error('  ERROR: No .slide elements found in the presentation.');
  console.error('  Make sure your HTML uses <div class="slide"> or <section class="slide">.');
  await browser.close();
  server.close();
  process.exit(1);
}

// Screenshot each slide
mkdirSync(SCREENSHOT_DIR, { recursive: true });
const screenshotPaths = [];

for (let i = 0; i < slideCount; i++) {
  // Navigate to slide by simulating the presentation's navigation
  // Most frontend-slides presentations use a currentSlide index and show/hide
  await page.evaluate((index) => {
    const slides = document.querySelectorAll('.slide');

    // Try multiple navigation strategies used by frontend-slides:

    // Strategy 1: Direct slide manipulation (most common in generated decks)
    slides.forEach((slide, idx) => {
      if (idx === index) {
        slide.style.display = '';
        slide.style.opacity = '1';
        slide.style.visibility = 'visible';
        slide.style.position = 'relative';
        slide.style.transform = 'none';
        slide.classList.add('active');
      } else {
        slide.style.display = 'none';
        slide.classList.remove('active');
      }
    });

    // Strategy 2: If there's a SlidePresentation class instance, use it
    if (window.presentation && typeof window.presentation.goToSlide === 'function') {
      window.presentation.goToSlide(index);
    }

    // Strategy 3: Scroll-based (some decks use scroll snapping)
    slides[index]?.scrollIntoView({ behavior: 'instant' });
  }, i);

  // Wait for any slide transition animations to finish
  await page.waitForTimeout(300);

  // Wait for intersection observer animations to trigger
  await page.waitForTimeout(200);

  // Force all .reveal elements on the current slide to be visible
  // (animations normally trigger on scroll/intersection, but we need them visible now)
  await page.evaluate((index) => {
    const slides = document.querySelectorAll('.slide');
    const currentSlide = slides[index];
    if (currentSlide) {
      currentSlide.querySelectorAll('.reveal').forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.visibility = 'visible';
      });
    }
  }, i);

  await page.waitForTimeout(100);

  const screenshotPath = join(SCREENSHOT_DIR, `slide-${String(i + 1).padStart(3, '0')}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  screenshotPaths.push(screenshotPath);
  console.log(`  Captured slide ${i + 1}/${slideCount}`);
}

await browser.close();
server.close();

// ─── Combine screenshots into PDF ─────────────────────────
// Use a second Playwright page to generate a PDF from the screenshots

console.log('  Assembling PDF...');

const pdfBrowser = await chromium.launch();
const pdfPage = await pdfBrowser.newPage();

// Build an HTML page with all screenshots, one per page
const imagesHtml = screenshotPaths.map((p) => {
  const imgData = readFileSync(p).toString('base64');
  return `<div class="page"><img src="data:image/png;base64,${imgData}" /></div>`;
}).join('\n');

const pdfHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; }
  @page { size: ${VP_WIDTH}px ${VP_HEIGHT}px; margin: 0; }
  .page {
    width: ${VP_WIDTH}px;
    height: ${VP_HEIGHT}px;
    page-break-after: always;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  img {
    width: ${VP_WIDTH}px;
    height: ${VP_HEIGHT}px;
    display: block;
    object-fit: contain;
  }
</style>
</head>
<body>${imagesHtml}</body>
</html>`;

await pdfPage.setContent(pdfHtml, { waitUntil: 'load' });
await pdfPage.pdf({
  path: OUTPUT_PDF,
  width: `${VP_WIDTH}px`,
  height: `${VP_HEIGHT}px`,
  printBackground: true,
  margin: { top: 0, right: 0, bottom: 0, left: 0 },
});

await pdfBrowser.close();

// Clean up screenshots
screenshotPaths.forEach(p => unlinkSync(p));

console.log(`  ✓ PDF saved to: ${OUTPUT_PDF}`);
