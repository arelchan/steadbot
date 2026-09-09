/**
 * Office files in the app's preview: PowerPoint, Word and Excel are converted to PDF once and then read with the
 * browser's own PDF viewer, which is the same thing every mail client and drive product does. LibreOffice does the
 * conversion (headless, no display); the result is cached per file version, so opening the same deck again is instant.
 */
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { config } from './config.ts';

/** What LibreOffice can turn into a PDF and the browser cannot show on its own. */
export const OFFICE_EXT = /^\.(pptx?|docx?|xlsx?|odp|odt|ods|rtf)$/i;

const CACHE = join(config.home, 'cache', 'preview');

/** Where soffice lives: on the machine it is on PATH, on a Mac it is inside the app bundle. */
let binary: string | null | undefined;
export function officeBinary(): string | null {
  if (binary !== undefined) return binary;
  const candidates = ['soffice', 'libreoffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  binary = null;
  for (const c of candidates) {
    try {
      execFileSync(c.includes('/') ? c : 'which', c.includes('/') ? ['--version'] : [c], { stdio: 'ignore', timeout: 10_000 });
      binary = c;
      break;
    } catch {
      /* try the next one */
    }
  }
  if (!binary) console.warn('[crew] LibreOffice not found: Office files fall back to "open in a system app"');
  return binary;
}

/** One conversion per output file, however many viewers ask for it at once. */
const inFlight = new Map<string, Promise<string>>();

/**
 * Convert `file` to a PDF and return its path. Cached on the file's own version (path + mtime + size), so editing
 * the deck and opening it again reconverts, and opening the same one twice does not.
 */
export function officeToPdf(file: string): Promise<string> {
  const st = statSync(file);
  const key = createHash('sha1').update(`${file}:${st.mtimeMs}:${st.size}`).digest('hex').slice(0, 16);
  const out = join(CACHE, `${key}.pdf`);
  if (existsSync(out)) return Promise.resolve(out);
  const running = inFlight.get(out);
  if (running) return running;
  const job = convert(file, out).finally(() => inFlight.delete(out));
  inFlight.set(out, job);
  return job;
}

async function convert(file: string, out: string): Promise<string> {
  const soffice = officeBinary();
  if (!soffice) throw new Error('no-libreoffice');
  mkdirSync(CACHE, { recursive: true });
  // Each run gets its own profile and output directory: LibreOffice refuses to run twice against one profile.
  const work = join(CACHE, `tmp-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(work, { recursive: true });
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        soffice,
        [`-env:UserInstallation=file://${join(work, 'profile')}`, '--headless', '--norestore', '--convert-to', 'pdf', '--outdir', work, file],
        { timeout: 120_000, maxBuffer: 4 << 20 },
        (err, _stdout, stderr) => (err ? reject(new Error(stderr?.toString().trim() || err.message)) : resolve()),
      );
    });
    const made = (await readdir(work)).find((n) => n.toLowerCase().endsWith('.pdf'));
    if (!made) throw new Error(`could not convert ${basename(file)}`);
    renameSync(join(work, made), out);
    return out;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export const isOffice = (file: string) => OFFICE_EXT.test(extname(file));
