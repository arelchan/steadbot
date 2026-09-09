import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/*
 * What version this is: a git commit on the product's repository. The machine the bots run on tracks the same
 * branch, so "is there a newer version" is a question about commits, not about files — and an upgrade is a fetch,
 * which is fast from anywhere GitHub is reachable. See upgrade.ts.
 *   HEAD    — the commit this checkout / image was built from;
 *   remote  — the newest commit on the branch we track.
 * A build with no git around (the Docker image ships a stamp instead) falls back to that stamp.
 */

const serverDir = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const repoDir = join(serverDir, '..');
/** Written into the image at build time (Dockerfile), because the image has no .git. */
const STAMP = join(serverDir, '.build-commit');

export const REPO = process.env.CREW_REPO ?? 'arelchan/everbot';
export const BRANCH = process.env.CREW_BRANCH ?? 'main';

const git = (args: string[], cwd = repoDir): string | undefined => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim() || undefined;
  } catch {
    return undefined;
  }
};

export const hasGit = () => existsSync(join(repoDir, '.git'));

/** The commit this code is, short form. */
export function currentCommit(): string | undefined {
  const fromGit = hasGit() ? git(['rev-parse', '--short=12', 'HEAD']) : undefined;
  if (fromGit) return fromGit;
  try {
    return readFileSync(STAMP, 'utf8').trim().slice(0, 12) || undefined;
  } catch {
    return undefined;
  }
}

/** True when the checkout has edits that are not committed — they cannot travel to another machine. */
export function isDirty(): boolean {
  if (!hasGit()) return false;
  return !!git(['status', '--porcelain', '--untracked-files=no']);
}

/** The newest commit on the branch we track, asked of GitHub directly (no clone, no auth for a public repo). */
export async function latestCommit(signal?: AbortSignal): Promise<string | undefined> {
  // A local checkout can just ask its own remote; that also works for a private repo, using the user's git auth.
  if (hasGit()) {
    const out = git(['ls-remote', 'origin', `refs/heads/${BRANCH}`]);
    const sha = out?.split(/\s+/)[0];
    if (sha) return sha.slice(0, 12);
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/commits/${BRANCH}`, {
      headers: { accept: 'application/vnd.github.sha', 'user-agent': 'everbot' },
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!r.ok) return undefined;
    return (await r.text()).trim().slice(0, 12);
  } catch {
    return undefined;
  }
}

export const VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

/** The commit this process started on; later commits show up as "there is a newer version". */
export const RUNNING_BUILD = currentCommit() ?? 'unknown';
