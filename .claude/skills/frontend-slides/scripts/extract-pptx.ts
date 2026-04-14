#!/usr/bin/env -S npx tsx
/**
 * extract-pptx.ts — Extract all content from a PowerPoint file (.pptx).
 * Returns a JSON structure with slides, text, and images
 *
 * Usage:
 *   npx tsx extract-pptx.ts <input.pptx> [output_dir]
 *   ./extract-pptx.ts <input.pptx> [output_dir]   (after chmod +x)
 *
 * Output:
 *   {output_dir}/extracted-slides.json
 *   {output_dir}/assets/slideN_imgM.{ext}
 *
 * Dependencies (install once in this directory):
 *   npm install jszip fast-xml-parser
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { existsSync } from "fs";
import { resolve, join, extname, posix } from "path";
import { fileURLToPath } from "url";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContentItem {
  type: "text";
  content: string;
}

interface ImageItem {
  path: string;   // relative path like "assets/slide1_img1.png"
  width: number;  // raw EMU integer (same as python-pptx .width)
  height: number; // raw EMU integer (same as python-pptx .height)
}

interface SlideData {
  number: number;
  title: string;
  content: ContentItem[];
  images: ImageItem[];
  notes: string;
}

// ─── XML Parser Setup ─────────────────────────────────────────────────────────

// Repeating elements that must always be arrays even when only one exists
const ARRAY_ELEMENTS = new Set([
  "p:sp", "p:pic", "p:grpSp",
  "a:p", "a:r", "a:br", "a:fld",
  "Relationship",
  "p:sldId",
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: false,       // preserve p:, a:, r: namespace prefixes as-is
  parseAttributeValue: true,   // cx/cy/etc become JS numbers automatically
  isArray: (name) => ARRAY_ELEMENTS.has(name),
});

function parseXml(xml: string): unknown {
  return parser.parse(xml);
}

// ─── Text Extraction ──────────────────────────────────────────────────────────

/**
 * Extract all text from a txBody element.
 * Joins runs within a paragraph without separator, paragraphs with "\n".
 * Matches python-pptx TextFrame.text behavior exactly.
 */
function extractText(txBody: unknown): string {
  const body = txBody as Record<string, unknown>;
  const paragraphs: Array<unknown> = asArray(body?.["a:p"]);
  return paragraphs
    .map((para) => {
      const p = para as Record<string, unknown>;
      let paraText = "";
      // Text runs
      for (const run of asArray(p["a:r"])) {
        const r = run as Record<string, unknown>;
        paraText += String((r["a:t"] as string | number | undefined) ?? "");
      }
      // Hard line breaks — treated as "\n" within the paragraph
      for (const br of asArray(p["a:br"])) {
        void br; // <a:br> has no text content; the break itself is the separator
        paraText += "\n";
      }
      // Field elements (e.g. slide numbers) — include their text
      for (const fld of asArray(p["a:fld"])) {
        const f = fld as Record<string, unknown>;
        paraText += String((f["a:t"] as string | number | undefined) ?? "");
      }
      return paraText;
    })
    .join("\n");
}

// ─── Slide Order Resolution ───────────────────────────────────────────────────

/**
 * Returns slide ZIP paths in presentation order, e.g. ["ppt/slides/slide2.xml", ...].
 * Uses ppt/presentation.xml sldIdLst + ppt/_rels/presentation.xml.rels.
 * This is authoritative even when filenames are non-sequential (deleted slides, etc).
 */
async function resolveSlideOrder(zip: JSZip): Promise<string[]> {
  const presXml = await readZipEntry(zip, "ppt/presentation.xml");
  const presRelsXml = await readZipEntry(zip, "ppt/_rels/presentation.xml.rels");

  if (!presXml) throw new Error("ppt/presentation.xml not found in ZIP");
  if (!presRelsXml) throw new Error("ppt/_rels/presentation.xml.rels not found in ZIP");

  const pres = parseXml(presXml) as Record<string, unknown>;
  const presRels = parseXml(presRelsXml) as Record<string, unknown>;

  // Build rId → target map for slide relationships
  const rels = asRecord(asRecord(presRels["Relationships"])["Relationship"]) as unknown;
  const relsArray = Array.isArray(rels) ? rels : [rels];
  const rIdToTarget = new Map<string, string>();
  for (const rel of relsArray) {
    const r = rel as Record<string, unknown>;
    const type = String(r["@_Type"] ?? "");
    if (type.endsWith("/slide")) {
      rIdToTarget.set(String(r["@_Id"]), String(r["@_Target"]));
    }
  }

  // Extract ordered rIds from presentation.xml sldIdLst
  const presRoot = asRecord(pres["p:presentation"]);
  const sldIdLst = asRecord(presRoot["p:sldIdLst"]);
  const sldIds = asArray(sldIdLst["p:sldId"]);

  const slideZipPaths: string[] = [];
  for (const sldId of sldIds) {
    const s = sldId as Record<string, unknown>;
    const rId = String(s["@_r:id"] ?? s["@_r:Id"] ?? "");
    const target = rIdToTarget.get(rId);
    if (target) {
      // Target is relative to ppt/ — normalize to full ZIP path
      slideZipPaths.push(posix.join("ppt", target));
    }
  }

  return slideZipPaths;
}

// ─── Rels Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a _rels XML file into a map of rId → target string.
 * Returns empty map if the rels file is missing.
 */
async function parseRels(zip: JSZip, relsPath: string): Promise<Map<string, string>> {
  const xml = await readZipEntry(zip, relsPath);
  if (!xml) return new Map();

  const parsed = parseXml(xml) as Record<string, unknown>;
  const relationships = asArray(asRecord(parsed["Relationships"])["Relationship"]);
  const map = new Map<string, string>();
  for (const rel of relationships) {
    const r = rel as Record<string, unknown>;
    map.set(String(r["@_Id"]), String(r["@_Target"]));
  }
  return map;
}

// ─── Shape Walking ────────────────────────────────────────────────────────────

/**
 * Collect all p:sp and p:pic elements from a spTree, recursing into p:grpSp groups.
 */
function collectShapes(spTree: Record<string, unknown>): {
  spShapes: Array<Record<string, unknown>>;
  picShapes: Array<Record<string, unknown>>;
} {
  const spShapes: Array<Record<string, unknown>> = [];
  const picShapes: Array<Record<string, unknown>> = [];

  for (const sp of asArray(spTree["p:sp"])) {
    spShapes.push(sp as Record<string, unknown>);
  }
  for (const pic of asArray(spTree["p:pic"])) {
    picShapes.push(pic as Record<string, unknown>);
  }
  for (const grp of asArray(spTree["p:grpSp"])) {
    const g = grp as Record<string, unknown>;
    const innerTree = asRecord(g["p:spTree"] ?? g);
    const inner = collectShapes(innerTree);
    spShapes.push(...inner.spShapes);
    picShapes.push(...inner.picShapes);
  }

  return { spShapes, picShapes };
}

// ─── Title Detection ──────────────────────────────────────────────────────────

function isTitle(sp: Record<string, unknown>): boolean {
  const nvSpPr = asRecord(sp["p:nvSpPr"]);
  const nvPr = asRecord(nvSpPr["p:nvPr"]);
  const ph = nvPr["p:ph"];
  if (!ph) return false;
  const phRec = asRecord(ph);
  const type = String(phRec["@_type"] ?? "");
  return type === "title" || type === "ctrTitle";
}

// ─── Notes Extraction ─────────────────────────────────────────────────────────

async function extractNotes(
  zip: JSZip,
  slideRels: Map<string, string>,
  slideZipPath: string,
): Promise<string> {
  // Slide rels targets are relative to ppt/slides/
  const slideDir = posix.dirname(slideZipPath); // e.g. "ppt/slides"

  for (const [, target] of slideRels) {
    if (!target.includes("notesSlide")) continue;
    const notesPath = posix.normalize(posix.join(slideDir, target));
    const xml = await readZipEntry(zip, notesPath);
    if (!xml) return "";

    const parsed = parseXml(xml) as Record<string, unknown>;
    const cSld = asRecord(asRecord(parsed["p:notes"])["p:cSld"]);
    const spTree = asRecord(cSld["p:spTree"]);
    const { spShapes } = collectShapes(spTree);

    for (const sp of spShapes) {
      const nvSpPr = asRecord(sp["p:nvSpPr"]);
      const nvPr = asRecord(nvSpPr["p:nvPr"]);
      const ph = asRecord(nvPr["p:ph"]);
      if (String(ph["@_type"] ?? "") === "body") {
        return extractText(sp["p:txBody"]);
      }
    }
    return "";
  }

  return "";
}

// ─── Main Extraction ──────────────────────────────────────────────────────────

async function extractPptx(filePath: string, outputDir: string): Promise<SlideData[]> {
  const fileBuffer = readFileSync(filePath);
  const zip = await JSZip.loadAsync(fileBuffer as unknown as Uint8Array);

  const assetsDir = join(outputDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const slideZipPaths = await resolveSlideOrder(zip);
  const slides: SlideData[] = [];

  for (let i = 0; i < slideZipPaths.length; i++) {
    const slideNum = i + 1;
    const slideZipPath = slideZipPaths[i];
    const slideData: SlideData = {
      number: slideNum,
      title: "",
      content: [],
      images: [],
      notes: "",
    };

    try {
      // ── Load slide XML ──────────────────────────────────────────────────────
      const slideXml = await readZipEntry(zip, slideZipPath);
      if (!slideXml) {
        console.error(`[warn] slide ${slideNum}: ${slideZipPath} not found in ZIP, skipping`);
        slides.push(slideData);
        continue;
      }

      const slideDoc = parseXml(slideXml) as Record<string, unknown>;
      const cSld = asRecord(asRecord(slideDoc["p:sld"])["p:cSld"]);
      const spTree = asRecord(cSld["p:spTree"]);

      // ── Load slide rels ─────────────────────────────────────────────────────
      const slideFileName = posix.basename(slideZipPath); // slide1.xml
      const relsPath = posix.join(
        posix.dirname(slideZipPath),
        "_rels",
        slideFileName + ".rels",
      );
      const slideRels = await parseRels(zip, relsPath);

      // ── Collect shapes ──────────────────────────────────────────────────────
      const { spShapes, picShapes } = collectShapes(spTree);

      // ── Find title ──────────────────────────────────────────────────────────
      let titleShapeIndex = -1;
      for (let j = 0; j < spShapes.length; j++) {
        if (isTitle(spShapes[j])) {
          titleShapeIndex = j;
          slideData.title = extractText(spShapes[j]["p:txBody"]);
          break;
        }
      }

      // ── Extract content text ────────────────────────────────────────────────
      for (let j = 0; j < spShapes.length; j++) {
        if (j === titleShapeIndex) continue;
        const sp = spShapes[j];
        if (sp["p:txBody"]) {
          slideData.content.push({
            type: "text",
            content: extractText(sp["p:txBody"]),
          });
        }
      }

      // ── Extract images ──────────────────────────────────────────────────────
      for (const pic of picShapes) {
        try {
          const blipFill = asRecord(pic["p:blipFill"]);
          const blip = asRecord(blipFill["a:blip"]);
          const rId = String(blip["@_r:embed"] ?? "");
          const relTarget = slideRels.get(rId);
          if (!relTarget) continue;

          // Resolve relative path from ppt/slides/ to get the ZIP entry path
          const slideDir = posix.dirname(slideZipPath);
          const mediaZipPath = posix.normalize(posix.join(slideDir, relTarget));
          const ext = extname(mediaZipPath).slice(1) || "bin";

          const imgIndex = slideData.images.length + 1;
          const imgName = `slide${slideNum}_img${imgIndex}.${ext}`;
          const imgFile = zip.file(mediaZipPath);
          if (!imgFile) {
            console.error(`[warn] slide ${slideNum} image ${imgIndex}: ${mediaZipPath} not found in ZIP`);
            continue;
          }
          const imgBytes = await imgFile.async("nodebuffer");
          writeFileSync(join(assetsDir, imgName), imgBytes as unknown as Uint8Array);

          // Dimensions in EMU from spPr > a:xfrm > a:ext
          const spPr = asRecord(pic["p:spPr"]);
          const xfrm = asRecord(spPr["a:xfrm"]);
          const ext_ = asRecord(xfrm["a:ext"]);
          const width = Number(ext_["@_cx"] ?? 0);
          const height = Number(ext_["@_cy"] ?? 0);

          slideData.images.push({
            path: `assets/${imgName}`,
            width,
            height,
          });
        } catch (imgErr) {
          console.error(`[warn] slide ${slideNum} image: ${imgErr}`);
        }
      }

      // ── Extract notes ───────────────────────────────────────────────────────
      slideData.notes = await extractNotes(zip, slideRels, slideZipPath);

    } catch (slideErr) {
      console.error(`[warn] slide ${slideNum}: ${slideErr}`);
    }

    slides.push(slideData);
  }

  return slides;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

async function readZipEntry(zip: JSZip, path: string): Promise<string | null> {
  const entry = zip.file(path);
  if (!entry) return null;
  return entry.async("string");
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// ─── CLI Entry Point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error("Usage: npx tsx extract-pptx.ts <input.pptx> [output_dir]");
    process.exit(1);
  }

  const inputFile = resolve(args[0]);
  const outputDir = args[1] ? resolve(args[1]) : process.cwd();

  if (!existsSync(inputFile)) {
    console.error(`Error: file not found: ${inputFile}`);
    process.exit(1);
  }

  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    console.error(`Error: cannot create output directory: ${outputDir}\n${err}`);
    process.exit(1);
  }

  let slides: SlideData[];
  try {
    slides = await extractPptx(inputFile, outputDir);
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }

  const outputPath = join(outputDir, "extracted-slides.json");
  writeFileSync(outputPath, JSON.stringify(slides, null, 2));

  console.log(`Extracted ${slides.length} slides to ${outputPath}`);
  for (const s of slides) {
    const imgCount = s.images.length;
    console.log(`  Slide ${s.number}: ${s.title || "(no title)"} — ${imgCount} image(s)`);
  }
}

// Run only when executed directly (not imported as a module)
const isMain =
  typeof process !== "undefined" &&
  process.argv[1] != null &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
