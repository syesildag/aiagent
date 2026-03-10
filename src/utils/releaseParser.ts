import * as fs from 'fs';
import * as path from 'path';

export interface Release {
   version: string;
   date: string;
   sections: { heading: string; items: string[] }[];
}

export interface ReleaseData {
   current: Release;
   all: Release[];
}

/** Parses RELEASES.md into structured release objects.
 *  Pass `current: true` to parse only the latest release (skips remaining blocks). */
export function parseReleases(opts?: { current?: boolean }): ReleaseData {
   const releasesPath = path.resolve(process.cwd(), 'RELEASES.md');
   const content = fs.readFileSync(releasesPath, 'utf-8');

   const releases: Release[] = [];
   // Split on ## [version] headings
   const blocks = content.split(/^## /m).slice(1);

   for (const block of blocks) {
      const lines = block.split('\n');
      const header = lines[0]; // e.g. "[1.1.0] - 2026-03-10"
      const match = header.match(/\[([^\]]+)]\s*-\s*(.+)/);
      if (!match) continue;

      const version = match[1].trim();
      const date = match[2].trim();
      const sections: { heading: string; items: string[] }[] = [];

      let current: { heading: string; items: string[] } | null = null;
      for (const line of lines.slice(1)) {
         const trimmed = line.trim();
         if (trimmed.startsWith('### ')) {
            if (current) sections.push(current);
            current = { heading: trimmed.replace('### ', ''), items: [] };
         } else if (trimmed.startsWith('- ') && current) {
            current.items.push(trimmed.slice(2));
         }
      }
      if (current) sections.push(current);

      releases.push({ version, date, sections });
      if (opts?.current) break;
   }

   return { current: releases[0], all: releases };
}
