// Solano Bay — entry program for the make.fun "Make GTA 6" bounty (gta6-01).
//
// The game itself is the static site in game/ (open game/index.html in a desktop
// browser, no build step, no network). This program is only the hand-in: it
// copies game/ and screenshots/ into the output directory and writes the
// dossier the judge reads, using the kit's vendored buildDossier so the bytes
// match the scorer's own rebuild exactly.
//
// Run locally with:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader MAKEFUN_OUTPUT_DIR is unset and the output is /output.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoDir, 'screenshots'))) {
  cpSync(join(repoDir, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The caps below are the gate's own (see the kit's RULES.txt): the dossier text
// is capped at 160 KiB, screenshots at 4 files of 256 KiB, game/ at 993 entries
// and 48 MiB with no path over 1,000 bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);
