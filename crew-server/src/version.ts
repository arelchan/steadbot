import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/*
 * What version this is. There is no release server: the code on the user's own computer is the source of truth,
 * so a "version" is a fingerprint of the server's own source. Three of them matter:
 *   running  — what this process started with (taken once, at boot);
 *   disk     — what is on disk right now (a restart would pick it up);
 *   machine  — what the machine the bots moved to is running (it reports its own).
 * The App compares them and offers one button. See upgrade.ts.
 */

const serverDir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
/** Everything whose change means a different build. Skipped: node_modules, data, the vendored skill library. */
const ROOTS = ['src', 'scripts', 'deploy', 'package.json', 'package-lock.json', 'Dockerfile'];

function walk(path: string, out: string[]) {
  let st;
  try {
    st = statSync(path);
  } catch {
    return;
  }
  if (st.isFile()) return void out.push(path);
  if (!st.isDirectory()) return;
  for (const name of readdirSync(path).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    walk(join(path, name), out);
  }
}

/** The skills present, by name only — enough to notice a machine that is missing most of the library. */
function librarySignature(): string {
  const lib = join(serverDir, 'library');
  const out: string[] = [];
  let cats: string[];
  try {
    cats = readdirSync(lib).sort();
  } catch {
    return '';
  }
  for (const c of cats) {
    if (c.startsWith('.') || c === 'manifest.json') continue;
    let slugs: string[];
    try {
      slugs = readdirSync(join(lib, c)).sort();
    } catch {
      continue;
    }
    for (const s of slugs) {
      try {
        if (statSync(join(lib, c, s, 'SKILL.md')).isFile()) out.push(`${c}/${s}`);
      } catch {
        /* not a skill directory */
      }
    }
  }
  return out.join(',');
}

/** sha256 over the source tree plus which skills are installed. Same code and skills give the same id. */
export function buildOfDisk(): string {
  const files: string[] = [];
  for (const r of ROOTS) walk(join(serverDir, r), files);
  const h = createHash('sha256');
  for (const f of files) {
    h.update(f.slice(serverDir.length));
    try {
      h.update(readFileSync(f));
    } catch {
      h.update('?');
    }
  }
  h.update('|library|');
  h.update(librarySignature());
  return h.digest('hex').slice(0, 12);
}

/** The build this process is running: taken once, so later edits on disk show up as "there is a newer version". */
export const RUNNING_BUILD = buildOfDisk();

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** A short, human-facing label: version plus the build, e.g. "0.1.0 · 8f2c1a90b3de". */
export const versionLabel = (build = RUNNING_BUILD) => `${VERSION} · ${build}`;
