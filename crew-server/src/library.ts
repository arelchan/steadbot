import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { LibraryEntry, LibraryKind } from './types.ts';
import type { SkillStore } from './skills.ts';
import { POPULAR_TOOLKITS, TOOLKITS, isChinesePlatform } from './connectors.ts';

/** How each kind reads in a list the bot sees. */
export const KIND_LABEL: Record<LibraryKind, string> = { skill: '手册', mcp: '外部工具', assets: '素材包' };
/** How an external tool set gets authorized: a login click, a key on a card, or nothing. */
export const authLabel = (e: LibraryEntry) => (e.service ? '一键登录' : e.mcp?.env?.length ? '填密钥' : '不用授权');

export const LIBRARY_CATEGORIES: Record<string, string> = {
  dev: '开发',
  docs: '文档办公',
  writing: '写作沟通',
  research: '研究数据',
  productivity: '效率生活',
  business: '商业营销',
  design: '设计创意',
  meta: '方法与元技能',
};

interface Manifest {
  categories?: Record<string, string>;
  skills: { slug: string; category: string; repo?: string; path?: string; tags?: string[] }[];
  /** Everything in the pool that is not a manual: MCP servers, asset packs. Pure data — nothing to clone, nothing on
   *  disk, so they live in the manifest and nowhere else. Platforms behind the OAuth service come from connectors.ts. */
  tools?: LibraryEntry[];
}

interface Loaded extends LibraryEntry {
  body: string;
  dir: string;
}

/**
 * The skill library: upstream SKILL.md directories pulled verbatim by `npm run library:sync` (see library/manifest.json)
 * into crew-server/library/<category>/<slug>/, mirrored into ~/.crew/library where the user can add their own.
 * Bots get matching skills mounted at birth and can search / mount more via the `library` tool. Mounting copies the
 * whole directory (SKILL.md plus scripts / references) into the SkillStore under the skill's upstream name — from
 * then on it's the bot's own skill and evolves with `build` like any other; the library copy stays pristine.
 */
export class Library {
  private entries = new Map<string, Loaded>();
  private manifest: Manifest = { skills: [] };
  readonly bundledDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'library');

  constructor(private userDir: string) {
    mkdirSync(userDir, { recursive: true });
    const mf = join(this.bundledDir, 'manifest.json');
    if (existsSync(mf)) {
      try {
        this.manifest = JSON.parse(readFileSync(mf, 'utf8')) as Manifest;
        Object.assign(LIBRARY_CATEGORIES, this.manifest.categories ?? {});
      } catch (e) {
        console.warn('[crew] library manifest unreadable:', (e as Error).message);
      }
    }
    this.sync();
    this.load();
  }

  /**
   * Mirror bundled skills into the user library: copy when the bundled SKILL.md differs, drop mirrored dirs that are
   * no longer bundled (tracked in .bundled.json so user-added skills are never touched).
   */
  private sync() {
    if (!existsSync(this.bundledDir)) return;
    const trackFile = join(this.userDir, '.bundled.json');
    let previous: string[] = [];
    try {
      previous = existsSync(trackFile) ? (JSON.parse(readFileSync(trackFile, 'utf8')) as string[]) : [];
    } catch {
      previous = [];
    }
    const current: string[] = [];
    for (const cat of readdirSync(this.bundledDir)) {
      const catDir = join(this.bundledDir, cat);
      if (!statSync(catDir).isDirectory()) continue;
      for (const slug of readdirSync(catDir)) {
        const src = join(catDir, slug);
        if (!existsSync(join(src, 'SKILL.md'))) continue;
        const rel = `${cat}/${slug}`;
        current.push(rel);
        const dst = join(this.userDir, rel);
        const sameFile = (f: string) => existsSync(join(dst, f)) === existsSync(join(src, f)) && (!existsSync(join(src, f)) || readFileSync(join(dst, f), 'utf8') === readFileSync(join(src, f), 'utf8'));
        const same = existsSync(join(dst, 'SKILL.md')) && sameFile('SKILL.md') && sameFile('.source.json');
        if (same) continue;
        rmSync(dst, { recursive: true, force: true });
        mkdirSync(dirname(dst), { recursive: true });
        cpSync(src, dst, { recursive: true });
      }
    }
    for (const rel of previous) if (!current.includes(rel)) rmSync(join(this.userDir, rel), { recursive: true, force: true });
    // A first run after the library switched formats: drop mirrored dirs that carry neither .source.json nor a user marker.
    if (!previous.length) {
      for (const cat of readdirSync(this.userDir)) {
        const catDir = join(this.userDir, cat);
        if (!statSync(catDir).isDirectory()) continue;
        for (const slug of readdirSync(catDir)) {
          const rel = `${cat}/${slug}`;
          if (current.includes(rel)) continue;
          const d = join(catDir, slug);
          const stale = existsSync(join(d, 'SKILL.md')) && /^name:\s*lib-/m.test(readFileSync(join(d, 'SKILL.md'), 'utf8'));
          if (stale) rmSync(d, { recursive: true, force: true });
        }
      }
    }
    writeFileSync(trackFile, JSON.stringify(current, null, 2));
  }

  private load() {
    this.entries.clear();
    const meta = new Map(this.manifest.skills.map((s) => [s.slug, s]));
    for (const cat of readdirSync(this.userDir)) {
      const catDir = join(this.userDir, cat);
      if (!statSync(catDir).isDirectory()) continue;
      for (const slug of readdirSync(catDir)) {
        const dir = join(catDir, slug);
        const file = join(dir, 'SKILL.md');
        if (!existsSync(file)) continue;
        const e = parseSkill(readFileSync(file, 'utf8'), slug, cat, dir, meta.get(slug));
        if (e) this.entries.set(e.slug, e);
      }
    }
    const skillCount = this.entries.size;
    for (const t of this.manifest.tools ?? []) {
      if (!t.slug || !t.kind || t.kind === 'skill') continue;
      this.entries.set(t.slug, { ...t, title: t.title || t.slug, category: t.category || 'design', description: t.description ?? '', tags: t.tags ?? [], body: '', dir: '' });
    }
    // Platforms behind the product's OAuth service are external tools too; the bot should find Gmail where it finds PixelLab.
    for (const t of TOOLKITS) {
      if (isChinesePlatform(t.slug) || this.entries.has(t.slug)) continue;
      this.entries.set(t.slug, { slug: t.slug, kind: 'mcp', category: t.category, title: t.title, description: t.description, tags: t.tags, service: t.slug, body: '', dir: '' });
    }
    console.log(`[crew] pool: ${skillCount} skills + ${this.entries.size - skillCount} tools in ${new Set([...this.entries.values()].map((e) => e.category)).size} categories`);
  }

  list(): LibraryEntry[] {
    return [...this.entries.values()].map(strip).sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
  }

  get(slug: string) {
    return this.entries.get(slug) ?? [...this.entries.values()].find((e) => e.title === slug);
  }

  /** Lexical search: title / tags / description hits, Chinese by bigram, ASCII by word. */
  search(query: string, limit = 8, category?: string): LibraryEntry[] {
    const terms = tokens(query);
    const scored = [...this.entries.values()]
      .filter((e) => !category || e.category === category)
      .map((e) => {
        const hay = { title: tokens(e.title.replace(/-/g, ' ')), tags: tokens(e.tags.join(' ')), desc: tokens(e.description) };
        let s = 0;
        for (const t of terms) {
          if (hay.title.has(t)) s += 3;
          if (hay.tags.has(t)) s += 2;
          if (hay.desc.has(t)) s += 1;
        }
        return { e, s };
      })
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, limit).map(({ e }) => strip(e));
  }

  /** Compact catalog for prompts: one line per entry. */
  catalogText(kind?: LibraryKind) {
    return this.list()
      .filter((e) => !kind || (e.kind ?? 'skill') === kind)
      .map((e) => `${e.slug}｜${KIND_LABEL[e.kind ?? 'skill']}｜${LIBRARY_CATEGORIES[e.category] ?? e.category}｜${e.tags.slice(0, 4).join(' ')}：${e.description.slice(0, 220)}`)
      .join('\n');
  }

  /**
   * Which library skills should a new bot carry? With a model: one cheap completion over the catalog, which also
   * says which of the bot's own skill phrases the picked manuals already cover (so they aren't generated twice).
   * Without: tag matching against the brief. Slugs come back most relevant first, at most `max`.
   */
  async pickForBot(bot: { name: string; role: string; skills: string[] }, brief: string, runtime?: ModelRuntime, model?: Model<Api>, max = 5): Promise<{ mount: string[]; covered: string[]; connections: string[] }> {
    if (!this.entries.size) return { mount: [], covered: [], connections: [] };
    const fallback = () => {
      const q = `${brief} ${bot.role} ${bot.skills.join(' ')}`;
      return { mount: this.search(q, max).filter((e) => e.category !== 'meta' && (e.kind ?? 'skill') === 'skill').map((e) => e.slug), covered: [], connections: [] };
    };
    if (!runtime || !model || model.provider === 'faux') return fallback();
    try {
      const res = await runtime.completeSimple(model, {
        systemPrompt:
          '下面是一个技能库的目录（每行：slug｜分类｜关键词：说明）和一个刚创建的 bot 的信息。请挑出这个 bot 履行职责时真正会用到的技能，输出严格 JSON：{"mount":["slug",…],"covered":["bot 的能力短语",…],"connections":["服务 slug",…]}。mount 按相关度从高到低，最多 5 个，可以为空；只选和职责直接相关的：代码类 bot 选代码分析、架构图、评审、排错、测试这类；写作类选写作、调研；办公类选文档表格；生活类可能一个都不需要；不要为了凑数选「方法与元技能」类。covered 列出 bot 自己的能力短语里已经被 mount 的手册完全覆盖的那些（原文照抄），没有就空数组。connections 列出这个 bot 履行职责必须接入的外部服务，只能从这些 slug 里选：' +
          POPULAR_TOOLKITS.join(', ') +
          '；只选职责里明确需要的（管邮件→gmail，看代码仓库→github，记 Notion→notion），拿不准就不选，没有就空数组。只输出 JSON。\n\n' +
          this.catalogText('skill'),
        messages: [{ role: 'user', content: `bot 名字：${bot.name}\n职责：${bot.role}\n能力短语：${bot.skills.join('、') || '（无）'}\n用户的第一句话：${brief}`, timestamp: Date.now() }],
      });
      const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end < 0) return fallback();
      const json = JSON.parse(raw.slice(start, end + 1)) as { mount?: unknown; covered?: unknown; connections?: unknown };
      // Only manuals are mounted at birth; the rest of the pool is for the bot to reach for when it meets the need.
      const mount = (Array.isArray(json.mount) ? json.mount : []).filter((x): x is string => typeof x === 'string' && (this.entries.get(x)?.kind ?? 'skill') === 'skill').slice(0, max);
      const covered = (Array.isArray(json.covered) ? json.covered : []).filter((x): x is string => typeof x === 'string' && bot.skills.includes(x));
      const connections = (Array.isArray(json.connections) ? json.connections : []).filter((x): x is string => typeof x === 'string' && POPULAR_TOOLKITS.includes(x.toLowerCase())).map((x) => x.toLowerCase()).slice(0, 3);
      return { mount, covered, connections };
    } catch (e) {
      console.warn('[crew] library pick fell back to tags:', (e as Error).message);
      return fallback();
    }
  }

  /** Copy a library skill (whole directory) into the SkillStore if not already there; returns its display name. */
  /** Copy a manual into the bot's own skills. Only manuals: the other kinds are equipped, not copied (index.ts). */
  mount(slug: string, skills: SkillStore): { name: string; fresh: boolean } {
    const e = this.get(slug);
    if (!e) throw new Error(`库里没有「${slug}」`);
    if ((e.kind ?? 'skill') !== 'skill') throw new Error(`「${slug}」不是手册，是${KIND_LABEL[e.kind ?? 'skill']}，用 build(action=add) 装`);
    if (skills.get(e.title)) return { name: e.title, fresh: false };
    const dst = skills.dirFor(e.title);
    mkdirSync(dst, { recursive: true });
    for (const f of readdirSync(e.dir)) {
      if (f === 'SKILL.md' || f === '.source.json') continue;
      cpSync(join(e.dir, f), join(dst, f), { recursive: true });
    }
    skills.write(e.title, e.description, e.body, { library: e.slug, category: e.category, source: e.source });
    return { name: e.title, fresh: true };
  }
}

/** The entry as the bot and the app see it: no body, no directory; a manual carries the path of its SKILL.md. */
function strip(e: Loaded): LibraryEntry {
  const { body: _b, dir, ...rest } = e;
  return dir ? { ...rest, path: join(dir, 'SKILL.md') } : rest;
}

function tokens(s: string): Set<string> {
  const out = new Set<string>();
  const lower = s.toLowerCase();
  for (const w of lower.match(/[a-z0-9][a-z0-9+.#-]*/g) ?? []) out.add(w);
  const han = lower.match(/[一-鿿]+/g) ?? [];
  for (const run of han) {
    for (let i = 0; i < run.length; i += 1) {
      out.add(run[i]);
      if (i + 1 < run.length) out.add(run.slice(i, i + 2));
    }
  }
  // single CJK chars are too noisy as matches; keep them only when the query is that short
  if (han.join('').length > 2) for (const t of [...out]) if (t.length === 1 && /[一-鿿]/.test(t)) out.delete(t);
  return out;
}

/** Read one top-level frontmatter scalar: plain, quoted, or a `>`/`|` block. */
function fmValue(fm: string, key: string): string {
  const lines = fm.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^${key}:`).test(l));
  if (i < 0) return '';
  const rest = lines[i].slice(key.length + 1).trim();
  if (/^[>|][-+]?$/.test(rest)) {
    const block: string[] = [];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j += 1) block.push(lines[j].trim());
    return rest.startsWith('>') ? block.join(' ') : block.join('\n');
  }
  if (rest.startsWith('"') || rest.startsWith("'")) {
    try {
      return rest.startsWith('"') ? (JSON.parse(rest) as string) : rest.slice(1, -1);
    } catch {
      return rest.replace(/^["']|["']$/g, '');
    }
  }
  return rest;
}

function parseSkill(raw: string, dirSlug: string, category: string, dir: string, meta?: Manifest['skills'][number]): Loaded | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return undefined;
  const fm = m[1];
  const body = m[2].replace(/^\n+/, '').trim();
  let source: string | undefined;
  let license: string | undefined;
  const srcFile = join(dir, '.source.json');
  if (existsSync(srcFile)) {
    try {
      const s = JSON.parse(readFileSync(srcFile, 'utf8')) as { url?: string; license?: string };
      source = s.url;
      license = s.license;
    } catch {
      /* ignore */
    }
  }
  const title = fmValue(fm, 'name') || dirSlug;
  return { slug: dirSlug, kind: 'skill', title, category: meta?.category ?? category, description: fmValue(fm, 'description'), tags: meta?.tags ?? [], source, license, body, dir };
}
