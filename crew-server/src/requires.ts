/**
 * What a skill needs, read out of the skill itself. Nobody annotates this by hand: a library of 50 manuals from 20
 * different authors would need 50 people to keep the annotations honest, and they would rot on the first upstream
 * change. Three sources instead — the scripts' own imports, the commands in the manual's code blocks, and the
 * "you need X installed" sentences — plus what the bot learns from an actual failure (tools.ts).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { builtinModules } from 'node:module';
import type { Requires } from './tools.ts';

/** Python's own modules: no `pip install os`. Kept as a literal because Node cannot ask Python. */
const PY_STDLIB = new Set(
  ('abc argparse array ast asyncio base64 binascii bisect builtins bz2 calendar cmath cmd codecs collections colorsys concurrent configparser contextlib copy csv ctypes curses dataclasses datetime decimal difflib dis email enum errno fcntl filecmp fileinput fnmatch fractions ftplib functools gc getopt getpass gettext glob gzip hashlib heapq hmac html http imaplib importlib inspect io ipaddress itertools json keyword linecache locale logging lzma mailbox math mimetypes mmap multiprocessing numbers operator os pathlib pickle pipes pkgutil platform plistlib poplib posixpath pprint profile pty pwd queue quopri random re readline reprlib resource select selectors shelve shlex shutil signal site smtplib socket socketserver sqlite3 ssl stat statistics string stringprep struct subprocess sys sysconfig tarfile tempfile termios textwrap threading time timeit tkinter token tokenize traceback tracemalloc tty types typing unicodedata unittest urllib uuid venv warnings wave weakref webbrowser xml xmlrpc zipfile zipimport zlib zoneinfo').split(
    ' ',
  ),
);
// `node:test`, `node:sqlite` and friends exist only under the prefix, so a bare `from 'test'` still resolves to a
// package — except in practice it never is one, and npm has no `test`. Treat these as built in either way.
const NODE_BUILTIN = new Set([...builtinModules, 'test', 'sqlite', 'sea']);

/** Import name → the thing pip actually installs. Only where they differ. */
const IMPORT_TO_PIP: Record<string, string> = {
  PIL: 'Pillow',
  docx: 'python-docx',
  pptx: 'python-pptx',
  yaml: 'PyYAML',
  cv2: 'opencv-python',
  bs4: 'beautifulsoup4',
  fitz: 'PyMuPDF',
  sklearn: 'scikit-learn',
  dateutil: 'python-dateutil',
  dotenv: 'python-dotenv',
  psycopg2: 'psycopg2-binary',
  serial: 'pyserial',
  git: 'GitPython',
  jwt: 'PyJWT',
  OpenSSL: 'pyOpenSSL',
  Crypto: 'pycryptodome',
  skimage: 'scikit-image',
};

/** `import PIL` fails, but the thing to install is called Pillow. */
export const pipNameFor = (mod: string) => IMPORT_TO_PIP[mod] ?? mod;

/** Commands worth recording when a manual tells the bot to run them; everything else is shell furniture. */
const CLI_WORTH = new Set(
  ('ffmpeg ffprobe soffice libreoffice pdftoppm pdftotext markitdown pandoc convert magick rembg tesseract gs qpdf mmdc d2 dot rg gh deno bun docker ollama jq').split(' '),
);
/** Shipped in the image or with the server; recording them would make every skill look broken. */
const ALREADY_HERE = new Set(('python python3 node npx npm pip pip3 git curl wget bash sh zip unzip tar sed awk grep find tsx tsc uv pytest make').split(' '));

const isText = (f: string) => !/\.(png|jpe?g|gif|webp|pdf|zip|gz|tgz|woff2?|ttf|otf|ico|mp4|mov|so|dylib)$/i.test(f);

/** Every directory name inside the skill, at any depth: candidates for a local package import. */
function localDirs(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 4) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const f = join(dir, name);
    if (statSync(f).isDirectory()) {
      out.push(name);
      localDirs(f, out, depth + 1);
    }
  }
  return out;
}

function walk(dir: string, out: string[] = [], depth = 0): string[] {
  if (depth > 6) return out;
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || name === 'node_modules' || name === '__pycache__') continue;
    const f = join(dir, name);
    const st = statSync(f);
    if (st.isDirectory()) walk(f, out, depth + 1);
    else if (st.isFile() && st.size < 400_000 && isText(name)) out.push(f);
  }
  return out;
}

/** Read one skill directory. Pure and offline: no model, no network. */
export function scanRequires(dir: string): Requires {
  const pip = new Set<string>();
  const npm = new Set<string>();
  const bin = new Set<string>();
  const files = walk(dir);
  // A skill's own helpers are imported the same way as PyPI packages (`from helpers.office import …`), so anything
  // that is a file or a directory inside the skill is not a dependency.
  const localPy = new Set([...files.filter((f) => f.endsWith('.py')).map((f) => basename(f, '.py')), ...localDirs(dir)]);

  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const ext = extname(f).toLowerCase();

    if (ext === '.py') {
      for (const m of text.matchAll(/^[ \t]*(?:from[ \t]+([\w.]+)|import[ \t]+([\w.]+))/gm)) {
        const mod = (m[1] || m[2]).split('.')[0];
        if (!mod || PY_STDLIB.has(mod) || mod === '__future__' || localPy.has(mod)) continue;
        pip.add(IMPORT_TO_PIP[mod] ?? mod);
      }
      for (const m of text.matchAll(/subprocess\.\w+\(\s*\[\s*['"]([\w.-]+)['"]/g)) if (CLI_WORTH.has(m[1])) bin.add(m[1]);
    }

    if (['.js', '.mjs', '.cjs', '.ts', '.tsx'].includes(ext)) {
      for (const m of text.matchAll(/(?:require\(\s*|from\s+)['"]([^'"./][^'"]*)['"]/g)) {
        const raw = m[1].startsWith('node:') ? m[1].slice(5) : m[1];
        const base = raw.startsWith('@') ? raw.split('/').slice(0, 2).join('/') : raw.split('/')[0];
        if (NODE_BUILTIN.has(base)) continue;
        npm.add(base);
      }
    }

    const name = basename(f).toLowerCase();
    if (name === 'requirements.txt') {
      for (const line of text.split('\n')) {
        const v = line.trim();
        if (v && !v.startsWith('#') && !v.startsWith('-')) pip.add(v.split(/[<>=[;!~ ]/)[0]);
      }
    }
    if (name === 'package.json') {
      try {
        const pkg = JSON.parse(text) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
        for (const k of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) npm.add(k);
      } catch {
        /* a package.json that does not parse tells us nothing */
      }
    }
    if (name === 'skill.md') {
      for (const fence of text.matchAll(/```(?:bash|sh|shell|zsh|console)?\n([\s\S]*?)```/g)) {
        for (const raw of fence[1].split('\n')) {
          const line = raw.trim().replace(/^\$\s*/, '').split('#')[0].trim();
          if (!line || /^[<[({]/.test(line)) continue;
          const tok = basename(line.split(/[\s|]+/)[0]);
          if (CLI_WORTH.has(tok)) bin.add(tok);
        }
      }
      for (const m of text.matchAll(/pip3?\s+install\s+([^\n`；，。）)]+)/g)) {
        const parts = m[1].split(/\s+/);
        for (let i = 0; i < parts.length; i++) {
          const t = parts[i];
          // `-r requirements.txt` installs a file, not a package named after it.
          if (t === '-r' || t === '--requirement' || t === '-e') i++;
          else if (t && !t.startsWith('-') && !/\.(txt|whl|tar\.gz)$/.test(t) && !t.includes('/')) pip.add(t.split(/[<>=[;]/)[0]);
        }
      }
      // Package names only, and only up to the first thing that is not one: prose after the command ("；终端运行 claude…") is not a package list.
      const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
      for (const m of text.matchAll(/npm\s+(?:install|i)\s+(?:-g\s+)?([^\n`；，。）)]+)/g)) {
        for (const t of m[1].split(/\s+/)) {
          if (!t) continue;
          if (t.startsWith('-')) continue;
          const name = t.replace(/@[^@/]+$/, '');
          if (!NPM_NAME.test(name)) break;
          npm.add(name);
        }
      }
      // "requires ffmpeg", "需要 LibreOffice"
      for (const m of text.matchAll(/`([\w.@/-]+)`[^.\n]{0,40}(?:preinstalled|is installed|must be installed|required|需要)/g)) {
        const tok = m[1].toLowerCase();
        if (CLI_WORTH.has(tok)) bin.add(tok);
      }
    }
  }

  const clean = (s: Set<string>) => [...s].filter((x) => x && x.length < 60 && !/[^\w.@/[\]-]/.test(x)).sort();
  return { pip: clean(pip), npm: clean(npm), bin: clean(bin).filter((b) => !ALREADY_HERE.has(b)) };
}

export interface RequiresFile extends Requires {
  derivedFrom: string;
  upstream?: string;
  at: number;
  /** what a real failure taught us, appended by tools.ts at runtime */
  learned?: { kind: 'pip' | 'npm' | 'bin'; name: string; at: number; from: string }[];
}

export const requiresPath = (dir: string) => join(dir, '.requires.json');

export function readRequires(dir: string): RequiresFile | undefined {
  const f = requiresPath(dir);
  if (!existsSync(f)) return undefined;
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as RequiresFile;
  } catch {
    return undefined;
  }
}

/** Write (or refresh) a skill's dependency record. Returns what was written. */
export function writeRequires(dir: string, extra: { upstream?: string; derivedFrom?: string } = {}): RequiresFile {
  const found = scanRequires(dir);
  const prev = readRequires(dir);
  const out: RequiresFile = {
    ...found,
    // Anything a failure taught us stays: the scanner cannot see what only shows up when the code runs.
    pip: [...new Set([...(found.pip ?? []), ...(prev?.learned ?? []).filter((l) => l.kind === 'pip').map((l) => l.name)])].sort(),
    npm: [...new Set([...(found.npm ?? []), ...(prev?.learned ?? []).filter((l) => l.kind === 'npm').map((l) => l.name)])].sort(),
    bin: [...new Set([...(found.bin ?? []), ...(prev?.learned ?? []).filter((l) => l.kind === 'bin').map((l) => l.name)])].sort(),
    derivedFrom: extra.derivedFrom ?? 'static',
    upstream: extra.upstream ?? prev?.upstream,
    at: Date.now(),
    learned: prev?.learned,
  };
  writeFileSync(requiresPath(dir), JSON.stringify(out, null, 2) + '\n');
  return out;
}

/** Record what a failure taught us, so the next machine installs it up front. */
export function learn(dir: string, kind: 'pip' | 'npm' | 'bin', name: string, from: string) {
  const cur = readRequires(dir) ?? { pip: [], npm: [], bin: [], derivedFrom: 'runtime', at: Date.now() };
  const list = new Set(cur[kind] ?? []);
  if (list.has(name)) return;
  list.add(name);
  cur[kind] = [...list].sort();
  cur.learned = [...(cur.learned ?? []), { kind, name, at: Date.now(), from }];
  cur.at = Date.now();
  writeFileSync(requiresPath(dir), JSON.stringify(cur, null, 2) + '\n');
}
