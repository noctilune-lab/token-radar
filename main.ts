// Token radar entry (Node 22, standard library only, no network).
//
// Reads the sealed snapshot, builds the ranked board with lib/model.ts, and writes:
//   <out>/board.json     the ranked board ({ meta, rows })
//   <out>/data.js        the dashboard's data (window.RADAR), beside dashboard/ (the page loads ../data.js)
//   <out>/dashboard/     copy of this repository's dashboard/
//   <out>/screenshots/   copy of this repository's screenshots/
//   <out>/dossier.json   buildDossier() from vendor/makefun-board.ts, written last
//
// Paths: input is --input <file|dir>, else $TOKEN_RADAR_INPUT, else /input/snapshot.json, else the kit's
// copy next to this repository. Output is --output, else $MAKEFUN_OUTPUT_DIR, else /output when it exists,
// else ./out beside this file. Output bytes depend only on the input: two runs write the same files.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardMeta, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? undefined : eq.slice(name.length + 3);
}

function resolveInput(): string {
  const asFile = (p: string): string => (p.endsWith('.json') ? p : join(p, 'snapshot.json'));
  const candidates = [arg('input'), process.env.TOKEN_RADAR_INPUT, '/input', join(here, '..', 'token-radar-01-kit', 'input')]
    .filter((c): c is string => c !== undefined && c !== '')
    .map(asFile);
  const found = candidates.find((c) => existsSync(c));
  if (found === undefined) {
    process.stderr.write(`token radar: no snapshot found (tried ${candidates.join(', ')}): pass --input <snapshot.json|dir>\n`);
    process.exit(2);
  }
  return found;
}

function resolveOutput(): string {
  const given = arg('output') ?? process.env.MAKEFUN_OUTPUT_DIR;
  if (given !== undefined && given !== '') return resolve(given);
  return existsSync('/output') ? '/output' : join(here, 'out');
}

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const inputFile = resolveInput();
const out = resolveOutput();
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);
const issue = boardIssue(radar.board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the board would fail the gate: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ meta: boardMeta(snapshot, radar), rows: radar.board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(snapshot, radar));
const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

const c = radar.counts;
process.stdout.write(
  `token radar: ${c.protocols} protocols (${c.has_token} with a token, ${c.pre_token} pre-token, ${c.pre_token_excluded} pre-token excluded), ` +
    `${c.board_rows} board rows, watchlist ${c.watchlist_on_board}/${c.watchlist}, ${c.below_watchlist_floor_rows} rows beyond the watchlist\n`,
);

if (shots.length < 3 || dash.length === 0) {
  // Round 1 has no dashboard design or screenshots yet: say so rather than write a dossier the gate would refuse.
  process.stderr.write(`token radar: dossier.json NOT written (dashboard files: ${dash.length}, screenshots: ${shots.length}; the gate needs 3-4 screenshots)\n`);
} else {
  for (const name of shots) {
    if (!IMAGE_NAME.test(name)) {
      process.stderr.write(`token radar: screenshots/${name}: bad name\n`);
      process.exit(1);
    }
  }
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }),
  );
  process.stdout.write(`token radar: wrote board.json, data.js, dashboard/ (${dash.length} files), screenshots/ (${shots.length}) and dossier.json in ${out}\n`);
}
