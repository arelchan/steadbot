import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/*
 * What version this is: a git commit on the product's repository, wearing the name of the tag it carries. The machine the bots run on tracks the same
 * branch, so "is there a newer version" is a question about commits, not about files — and an upgrade is a fetch,
 * which is fast from anywhere GitHub is reachable. See upgrade.ts.
 *   HEAD    — the commit this checkout / image was built from;
 *   remote  — the newest commit on the branch we track.
 * A build with no git around (the Docker image ships a stamp instead) falls back to that stamp.
 *
 * A commit is what the machines compare; a tag is what a person can hold on to. `v0.1.0` names the commit it sits
 * on, and a commit further along the branch reads as `v0.1.0+3` — so a version always has a name, tagged or not.
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

/**
 * The commit this code is, short form. In a container there is no .git: the commit arrives as CREW_COMMIT (set by
 * the installer and refreshed on every upgrade, so a restart-only upgrade still reports the right one), and the
 * stamp baked at image build time is the last resort.
 */
export function currentCommit(): string | undefined {
  const fromEnv = process.env.CREW_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);
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

/* ---------------- 版本名：标签 ---------------- */

const TAG_TTL = 5 * 60_000;
let tagCache: { at: number; map: Map<string, string> } | undefined;
let fetchedAt = 0;

/**
 * Pull the branch's objects and its tags in, so a commit that was made after this checkout — the one the machine is
 * running, say — can still be named. Throttled, quiet, and never merges anything into the working tree.
 */
export function syncTags(): void {
  if (!hasGit() || Date.now() - fetchedAt < TAG_TTL) return;
  fetchedAt = Date.now();
  git(['fetch', '--quiet', '--tags', '--force', 'origin', BRANCH]);
}

/** sha → tag, asked of the remote: a tag pushed after this checkout was made counts just the same. */
function remoteTags(): Map<string, string> {
  if (tagCache && Date.now() - tagCache.at < TAG_TTL) return tagCache.map;
  const map = new Map<string, string>();
  for (const line of (hasGit() ? git(['ls-remote', '--tags', 'origin']) : undefined)?.split('\n') ?? []) {
    const [sha, ref] = line.trim().split(/\s+/);
    const name = /^refs\/tags\/(.+?)(?:\^\{\})?$/.exec(ref ?? '')?.[1];
    // An annotated tag shows up twice (the tag object, then the commit as `^{}`); both shas take the same name.
    if (sha && name) map.set(sha.slice(0, 12), name);
  }
  tagCache = { at: Date.now(), map };
  return map;
}

/**
 * The name of a commit: its own tag, else the last tag plus how far past it (`v0.1.0+3`), else nothing. Local git
 * answers first (it knows the whole history); the remote is asked only for a tag this checkout has not fetched.
 */
export function versionName(sha?: string): string | undefined {
  if (!sha) return undefined;
  const short = sha.slice(0, 12);
  const described = hasGit() ? git(['describe', '--tags', '--long', short]) : undefined;
  const m = described ? /^(.+)-(\d+)-g[0-9a-f]+$/.exec(described) : undefined;
  if (m) return m[2] === '0' ? m[1] : `${m[1]}+${m[2]}`;
  return remoteTags().get(short);
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

/** Version as one line for logs and 关于. */
export const versionLine = () => `${versionName(RUNNING_BUILD) ?? VERSION} · ${RUNNING_BUILD} · ${REPO}@${BRANCH}`;
