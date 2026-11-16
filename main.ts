// Pasar Senja — Tactical FPS. Entry program (Node 22, standard library only).
//
// The game itself is plain static files under game/ (ES modules, three.js from
// the import map, no build step, no network). This program is the handoff: it
// copies game/ and screenshots/ from beside this file into the output
// directory and writes dossier.json there, using the vendored make.fun
// library (vendor/makefun-threejs.ts) so the judge reads exactly what the
// gate recomputes. Outside the grader, MAKEFUN_OUTPUT_DIR stands in for
// /output:
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The program is deterministic: same input files, same output bytes, every
// run. It refuses nothing silently — a missing game/ or screenshots/ is an
// error, because an entry without them would fail the gate anyway.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

if (!existsSync(join(here, 'game'))) {
  throw new Error('game/ is missing beside main.ts');
}
if (!existsSync(join(here, 'screenshots'))) {
  throw new Error('screenshots/ is missing beside main.ts');
}

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// Caps from the gate: at most 4 screenshots of 256 KiB each, at most 993
// files / 48 MiB under game/, dossier text capped at 160 KiB. buildDossier
// enforces them and the gate recomputes the same dossier byte for byte.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
  }),
);
