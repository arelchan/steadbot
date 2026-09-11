import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRequires, writeRequires } from './requires.ts';
import type { SkillDoc } from './types.ts';

/**
 * Skills are real pi skills: one directory per skill under the crew pi agentDir with a SKILL.md
 * (frontmatter + markdown body). Bots reference skills by display name (Bot.skills); pi requires
 * lowercase ASCII names, so each display name maps to a stable slug kept in skills-index.json.
 */
export class SkillStore extends EventEmitter {
  private index: Record<string, string> = {};
  private indexFile: string;
  private generating = new Set<string>();

  constructor(
    private dir: string,
    readonly botId?: string,
  ) {
    super();
    mkdirSync(dir, { recursive: true });
    this.indexFile = join(dir, '..', 'skills-index.json');
    if (existsSync(this.indexFile)) {
      try {
        this.index = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Record<string, string>;
      } catch {
        this.index = {};
      }
    }
  }

  private saveIndex() {
    writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
  }

  slugFor(name: string): string {
    const n = name.trim();
    if (this.index[n]) return this.index[n];
    const slug = `s-${createHash('sha1').update(n).digest('hex').slice(0, 8)}`;
    this.index[n] = slug;
    this.saveIndex();
    return slug;
  }

  /** Directory a skill's files live in (created on write). */
  /** What this skill needs on the machine, as last scanned. */
  /** Rescan a manual's dependencies (the scanner improved, or the files changed under it). */
  refreshRequires(name: string) {
    const slug = this.index[name.trim()];
    if (!slug) return;
    const prev = this.read(name.trim());
    writeRequires(join(this.dir, slug), { derivedFrom: prev?.library ? 'static' : 'static:own' });
  }

  requiresOf(name: string) {
    const slug = this.index[name.trim()];
    return slug ? readRequires(join(this.dir, slug)) : undefined;
  }

  dirFor(name: string) {
    return join(this.dir, this.slugFor(name));
  }

  has(name: string) {
    const slug = this.index[name.trim()];
    return !!slug && existsSync(join(this.dir, slug, 'SKILL.md'));
  }

  private read(name: string): SkillDoc | undefined {
    const slug = this.index[name];
    if (!slug) return undefined;
    const file = join(this.dir, slug, 'SKILL.md');
    if (!existsSync(file)) return undefined;
    const raw = readFileSync(file, 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw);
    let description = '';
    let body = raw;
    if (m) {
      const fm = m[1];
      body = m[2].replace(/^\n+/, '');
      const d = /^description:\s*(.*)$/m.exec(fm)?.[1] ?? '';
      try {
        description = d.startsWith('"') ? (JSON.parse(d) as string) : d;
      } catch {
        description = d;
      }
    }
    const meta = (key: string) => {
      const v = new RegExp(`^  ${key}:\\s*(.*)$`, 'm').exec(m?.[1] ?? '')?.[1]?.trim();
      if (!v) return undefined;
      try {
        return v.startsWith('"') ? (JSON.parse(v) as string) : v;
      } catch {
        return v;
      }
    };
    return {
      name,
      slug,
      botId: this.botId,
      description,
      body,
      updatedAt: Number(/updatedAt:\s*(\d+)/.exec(m?.[1] ?? '')?.[1] ?? 0),
      generating: this.generating.has(name),
      library: meta('library'),
      category: meta('category'),
      source: meta('source'),
      needs: (() => {
        const v = meta('needs');
        if (!v) return undefined;
        try {
          const a = JSON.parse(v) as unknown;
          return Array.isArray(a) && a.length && a.every((x) => typeof x === 'string') ? (a as string[]) : undefined;
        } catch {
          return undefined;
        }
      })(),
    };
  }

  get(name: string) {
    return this.read(name.trim());
  }

  list(): SkillDoc[] {
    const docs: SkillDoc[] = [];
    for (const name of Object.keys(this.index)) {
      const d = this.read(name);
      if (d) docs.push(d);
      else if (this.generating.has(name)) docs.push({ name, slug: this.index[name], botId: this.botId, description: '', body: '', updatedAt: 0, generating: true });
    }
    return docs;
  }

  write(name: string, description: string, body: string, meta?: { library?: string; category?: string; source?: string; needs?: string[] }) {
    const n = name.trim();
    const slug = this.slugFor(n);
    mkdirSync(join(this.dir, slug), { recursive: true });
    const now = Date.now();
    // Provenance survives edits: whatever meta doesn't mention, the document keeps.
    const cur0 = this.read(n);
    const prev = { ...(cur0 ? { library: cur0.library, category: cur0.category, source: cur0.source, needs: cur0.needs } : {}), ...(meta ?? {}) };
    const fm = [
      '---',
      `name: ${slug}`,
      `description: ${JSON.stringify(description.replace(/\s+/g, ' ').trim().slice(0, 1000))}`,
      'metadata:',
      `  title: ${JSON.stringify(n)}`,
      `  updatedAt: ${now}`,
      ...(prev.library ? [`  library: ${JSON.stringify(prev.library)}`] : []),
      ...(prev.category ? [`  category: ${JSON.stringify(prev.category)}`] : []),
      ...(prev.source ? [`  source: ${JSON.stringify(prev.source)}`] : []),
      ...(prev.needs?.length ? [`  needs: ${JSON.stringify(prev.needs)}`] : []),
      `updatedAt: ${now}`,
      '---',
      '',
    ].join('\n');
    writeFileSync(join(this.dir, slug, 'SKILL.md'), fm + body.trim() + '\n');
    // What this manual needs to actually run, read out of the manual and its scripts (requires.ts). Written here so
    // a skill the bot wrote itself is treated exactly like one from the library.
    try {
      writeRequires(join(this.dir, slug), { derivedFrom: prev.library ? 'static' : 'static:own' });
    } catch (e) {
      console.warn('[crew] requires scan failed for', n, (e as Error).message);
    }
    this.generating.delete(n);
    const doc = this.read(n)!;
    this.emit('change', doc);
    return doc;
  }

  patch(name: string, patch: { description?: string; body?: string }) {
    const cur = this.get(name);
    if (!cur) return undefined;
    return this.write(name, patch.description ?? cur.description, patch.body ?? cur.body);
  }

  remove(name: string) {
    const slug = this.index[name];
    if (!slug) return;
    rmSync(join(this.dir, slug), { recursive: true, force: true });
    delete this.index[name];
    this.saveIndex();
  }

  /** Make sure every named skill has a document; missing ones are produced by `gen` (LLM or template). */
  async ensure(names: string[], gen: (missing: string[]) => Promise<{ name: string; description: string; body: string }[]>) {
    const missing = Array.from(new Set(names.map((n) => n.trim()).filter((n) => n && !this.has(n) && !this.generating.has(n))));
    if (!missing.length) return;
    for (const n of missing) {
      this.generating.add(n);
      this.slugFor(n);
      this.emit('change', { name: n, slug: this.index[n], botId: this.botId, description: '', body: '', updatedAt: 0, generating: true } satisfies SkillDoc);
    }
    try {
      const docs = await gen(missing);
      for (const n of missing) {
        const d = docs.find((x) => x.name === n) ?? docs[missing.indexOf(n)];
        this.write(n, d?.description ?? '', d?.body ?? `# ${n}\n\n（说明待补充）`);
      }
    } catch (e) {
      console.warn('[crew] skill generation failed:', (e as Error).message);
      for (const n of missing) this.write(n, '', `# ${n}\n\n（说明生成失败，可以在这里手写。）`);
    }
  }
}

/**
 * One skill directory per bot.
 *
 * A manual is the bot's own: it mounts it, then rewrites it with `build` as it learns. While every bot's manuals
 * sat in one shared directory that was quietly false — 调研助手 and 调研助手 2 pointed at the same three files, so
 * either one evolving「deep-research」rewrote the other's copy, and no two bots could ever both keep a manual called
 *「日报」. Each bot's manuals now live under its own workspace at `<botDir>/.pi/skills`, which is also where pi looks
 * for "project" skills when the session's cwd is that bot's directory. What a bot carries is what is in its own
 * directory; `<agentDir>/skills` is left to the product's own built-in manuals, which every bot shares by design.
 */
export class SkillStores extends EventEmitter {
  private stores = new Map<string, SkillStore>();

  constructor(
    private botsDir: string,
    readonly builtin: SkillStore,
  ) {
    super();
  }

  of(botId: string): SkillStore {
    let s = this.stores.get(botId);
    if (!s) {
      s = new SkillStore(join(this.botsDir, botId, '.pi', 'skills'), botId);
      s.on('change', (d: SkillDoc) => this.emit('change', d));
      this.stores.set(botId, s);
    }
    return s;
  }

  /** Every store there is: one per bot, plus the product's own. */
  all(botIds: string[]): SkillStore[] {
    return [...botIds.map((id) => this.of(id)), this.builtin];
  }

  /** Every bot's manuals plus the product's own, as the app lists them. */
  list(botIds: string[]): SkillDoc[] {
    return this.all(botIds).flatMap((s) => s.list());
  }

  drop(botId: string) {
    this.stores.delete(botId);
  }
}

/**
 * Homes written before bots had their own directories: give each bot a copy of what its record says it carries,
 * then leave the shared directory holding only the product's own manuals. Everything taken out of it is set aside
 * rather than deleted — a manual nobody claims (a deleted bot's, or one written by the birth path that no longer
 * exists) is unreachable either way, and throwing away somebody's writing to tidy a directory is not a trade worth
 * making.
 */
export function migrateSharedSkills(stores: SkillStores, bots: { id: string; skills: string[] }[], keep: string[], asideDir: string): number {
  const legacy = stores.builtin;
  const keepSet = new Set(keep);
  let moved = 0;
  for (const b of bots) {
    const own = stores.of(b.id);
    for (const name of b.skills) {
      // The product's own manuals stay where they are: every bot reads them out of the shared directory.
      if (keepSet.has(name) || !legacy.has(name) || own.has(name)) continue;
      cpSync(legacy.dirFor(name), own.dirFor(name), { recursive: true });
      moved += 1;
    }
  }
  let aside = 0;
  for (const name of legacy.list().map((d) => d.name)) {
    if (keepSet.has(name)) continue;
    try {
      mkdirSync(asideDir, { recursive: true });
      renameSync(legacy.dirFor(name), join(asideDir, legacy.slugFor(name)));
      legacy.remove(name);
      aside += 1;
    } catch (e) {
      console.warn(`[crew] 技能「${name}」没能从公共目录挪走：`, (e as Error).message);
    }
  }
  if (moved || aside) console.log(`[crew] 技能搬家：${moved} 份进了各自 bot 的目录，公共目录留下产品自带的，另外 ${aside} 份没人认领的挪到了 ${asideDir}`);
  return moved;
}
