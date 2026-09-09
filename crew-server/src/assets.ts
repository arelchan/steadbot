/**
 * Asset packs. A game or a deck made entirely of generated pictures looks generated; a free CC0 pack looks like a
 * product. Downloading one is not something a bot should have to write shell for, so the pool does it: fetch, unzip,
 * report where it landed.
 */
import { execFile } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, join } from 'node:path';

const MAX_BYTES = 600 << 20;

const run = (cmd: string, args: string[], timeout = 300_000) =>
  new Promise<void>((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, _o, stderr) => (err ? reject(new Error(stderr?.toString().slice(-300) || err.message)) : resolve()));
  });

const countFiles = (dir: string, depth = 0): number => {
  if (depth > 6 || !existsSync(dir)) return 0;
  let n = 0;
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    n += statSync(f).isDirectory() ? countFiles(f, depth + 1) : 1;
  }
  return n;
};

/** Download `url` into `dir`, unpacking a zip or tarball. Returns where it is and how much came down. */
export async function fetchAssets(url: string, dir: string): Promise<{ dir: string; files: number }> {
  if (!/^https:\/\//.test(url)) throw new Error('素材包地址必须是 https');
  if (existsSync(dir) && countFiles(dir) > 0) return { dir, files: countFiles(dir) };
  mkdirSync(dir, { recursive: true });
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`);
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_BYTES) throw new Error(`素材包太大（${Math.round(size / (1 << 20))} MB），换一个或让用户手动下载`);
  const name = basename(new URL(url).pathname) || 'assets.bin';
  const file = join(dir, name);
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), createWriteStream(file));
  try {
    if (/\.zip$/i.test(name)) {
      await run('unzip', ['-q', '-o', file, '-d', dir]);
      rmSync(file, { force: true });
    } else if (/\.(tar\.gz|tgz|tar)$/i.test(name)) {
      await run('tar', ['-xf', file, '-C', dir]);
      rmSync(file, { force: true });
    }
  } catch (e) {
    // A pack that cannot be unpacked is still a file the bot can work with; say so rather than failing the equip.
    console.warn('[crew] assets unpack failed:', (e as Error).message);
  }
  return { dir, files: countFiles(dir) };
}
