// WP-LOOK part (a2) round 2 (session 144): the typeface for the share
// preview image. Inter (SIL Open Font License 1.1, assets/fonts/LICENSE.txt)
// ships in the repo so the image tool has the site's own face at runtime —
// on Vercel there is no system font to fall back to, and the tool only sees
// fonts handed to it as bytes. Read once per process from `assets/fonts`
// relative to the app root (the deploy runs from `web/`; next.config.ts lists
// the files for the function bundle).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { SHARE_PREVIEW_FONT } from './share-preview.tsx';

export interface PreviewFont {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 600 | 700;
  style: 'normal';
}

const FILES: { file: string; weight: PreviewFont['weight'] }[] = [
  { file: 'Inter-Regular.ttf', weight: 400 },
  { file: 'Inter-SemiBold.ttf', weight: 600 },
  { file: 'Inter-Bold.ttf', weight: 700 },
];

let cached: Promise<PreviewFont[]> | null = null;

export function loadPreviewFonts(): Promise<PreviewFont[]> {
  cached ??= Promise.all(
    FILES.map(async ({ file, weight }) => {
      const buf = await readFile(join(process.cwd(), 'assets', 'fonts', file));
      return { name: SHARE_PREVIEW_FONT, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, weight, style: 'normal' as const };
    }),
  ).catch((err: unknown) => {
    cached = null;
    throw err;
  });
  return cached;
}
