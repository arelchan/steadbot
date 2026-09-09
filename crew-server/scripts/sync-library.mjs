#!/usr/bin/env node
// Pull every skill in library/manifest.json from its upstream GitHub repo, verbatim, into library/<category>/<slug>/.
// One sparse, blobless clone per repo; the copied directory keeps SKILL.md and all supporting files, plus the
// repo's LICENSE (as LICENSE.upstream) and a .source.json with repo / path / commit / license.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const only = new Set(process.argv.slice(2));
const work = join(tmpdir(), `crew-library-sync-${process.pid}`);
mkdirSync(work, { recursive: true });

const byRepo = new Map();
for (const s of manifest.skills) {
  if (only.size && !only.has(s.slug)) continue;
  if (!s.repo) continue; // written here, not pulled from anywhere

  byRepo.set(s.repo, [...(byRepo.get(s.repo) ?? []), s]);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
const licenseOf = (dir) => {
  const f = readdirSync(dir).find((n) => /^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(n));
  if (!f) return undefined;
  const text = readFileSync(join(dir, f), 'utf8');
  const head = text.slice(0, 400);
  const id = /Apache License[\s\S]{0,40}Version 2\.0/i.test(head) ? 'Apache-2.0' : /MIT License/i.test(head) ? 'MIT' : /Creative Commons Attribution-ShareAlike 4\.0/i.test(head) ? 'CC-BY-SA-4.0' : /GNU GENERAL PUBLIC LICENSE[\s\S]{0,40}Version 3/i.test(head) ? 'GPL-3.0' : /All rights reserved/i.test(head) ? 'proprietary' : 'see LICENSE';
  return { id, file: f, text };
};

const report = [];
for (const [repo, skills] of byRepo) {
  const dir = join(work, repo.replace('/', '__'));
  process.stdout.write(`↓ ${repo} … `);
  execFileSync('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--sparse', `https://github.com/${repo}.git`, dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  git(dir, 'sparse-checkout', 'set', '--no-cone', ...skills.map((s) => `/${s.path}/`), ...skills.flatMap((s) => (s.extras ?? []).map((e) => `/${e}`)), '/LICENSE*', '/LICENCE*', '/COPYING*');
  const commit = git(dir, 'rev-parse', '--short', 'HEAD');
  const repoLicense = licenseOf(dir);
  console.log(`${commit}${repoLicense ? ` · ${repoLicense.id}` : ' · no repo LICENSE'}`);
  for (const s of skills) {
    const src = join(dir, s.path);
    if (!existsSync(join(src, 'SKILL.md'))) {
      console.log(`  ✗ ${s.slug}: ${s.path}/SKILL.md not found upstream`);
      report.push({ slug: s.slug, ok: false });
      continue;
    }
    const dst = join(root, s.category, s.slug);
    rmSync(dst, { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
    for (const e of s.extras ?? []) {
      const from = join(dir, e);
      if (!existsSync(from)) {
        console.log(`  ! ${s.slug}: extra ${e} not found upstream`);
        continue;
      }
      const to = join(dst, '_upstream', e.split('/').pop());
      mkdirSync(dirname(to), { recursive: true });
      cpSync(from, to, { recursive: true });
    }
    const skillLicense = licenseOf(src);
    const license = skillLicense ?? repoLicense;
    if (repoLicense && !skillLicense) writeFileSync(join(dst, 'LICENSE.upstream'), repoLicense.text);
    const files = readdirSync(dst, { recursive: true }).filter((f) => !String(f).startsWith('.')).length;
    writeFileSync(
      join(dst, '.source.json'),
      JSON.stringify({ repo, path: s.path, commit, url: `https://github.com/${repo}/tree/HEAD/${s.path}`, license: license?.id ?? 'unspecified', licenseFile: license?.file, fetchedAt: new Date().toISOString() }, null, 2) + '\n',
    );
    console.log(`  ✓ ${s.slug} (${files} files, ${license?.id ?? 'no license'})`);
    report.push({ slug: s.slug, ok: true, license: license?.id ?? 'unspecified' });
  }
}
rmSync(work, { recursive: true, force: true });
const bad = report.filter((r) => !r.ok);
console.log(`\n${report.length - bad.length} skills synced${bad.length ? `, ${bad.length} missing: ${bad.map((b) => b.slug).join(', ')}` : ''}.`);
const unl = report.filter((r) => r.ok && (r.license === 'unspecified' || r.license === 'proprietary'));
if (unl.length) console.log(`License to review before redistributing: ${unl.map((r) => `${r.slug} (${r.license})`).join(', ')}`);
