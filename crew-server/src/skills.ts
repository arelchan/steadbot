import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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

  constructor(private dir: string) {
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
      description,
      body,
      updatedAt: Number(/updatedAt:\s*(\d+)/.exec(m?.[1] ?? '')?.[1] ?? 0),
      generating: this.generating.has(name),
      library: meta('library'),
      category: meta('category'),
      source: meta('source'),
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
      else if (this.generating.has(name)) docs.push({ name, slug: this.index[name], description: '', body: '', updatedAt: 0, generating: true });
    }
    return docs;
  }

  write(name: string, description: string, body: string, meta?: { library?: string; category?: string; source?: string }) {
    const n = name.trim();
    const slug = this.slugFor(n);
    mkdirSync(join(this.dir, slug), { recursive: true });
    const now = Date.now();
    // Provenance survives edits: a patch() without meta keeps what the document already carries.
    const prev = meta ?? (() => {
      const cur = this.read(n);
      return cur ? { library: cur.library, category: cur.category, source: cur.source } : {};
    })();
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
      this.emit('change', { name: n, slug: this.index[n], description: '', body: '', updatedAt: 0, generating: true } satisfies SkillDoc);
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
