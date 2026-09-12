import { noteUsage } from './meter.ts';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { LibraryEntry, LibraryKind } from './types.ts';
import type { SkillStore } from './skills.ts';
import { POPULAR_TOOLKITS, TOOLKITS, isChinesePlatform } from './connectors.ts';
import { canEmbed, dot, embed, embedModel, embedOne, packVec, unpackVec } from './embed.ts';
import { jsonFromModel } from './util.ts';

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
  product: '产品',
  finance: '财务金融',
  legal: '法务合规',
  people: '人事招聘',
  sales: '销售客服',
  science: '科研',
  media: '音视频',
};

interface Manifest {
  categories?: Record<string, string>;
  skills: { slug: string; category: string; repo?: string; path?: string; tags?: string[]; description?: string; exclude?: string[] }[];
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
  private vecs = new Map<string, Float32Array>();
  private indexing?: Promise<void>;
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
    // Meaning-level search over the pool, built in the background: nothing waits for it, and the first bot born on a
    // fresh machine simply gets the word-overlap half.
    void this.index();
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

  /** What a manual is about, as one string: the text both halves of the search look at. */
  private textOf(e: LibraryEntry) {
    return `${e.title}｜${e.tags.join(' ')}｜${e.description}`.replace(/\s+/g, ' ').slice(0, 600);
  }

  /**
   * The pool as vectors, on disk (~/.crew/library/.vectors.json). An entry is re-embedded only when its own text
   * changes, so a library sync costs a few calls rather than 230, and a machine with no key just never has an index.
   */
  async index(): Promise<void> {
    if (this.indexing) return this.indexing;
    this.indexing = (async () => {
      if (!canEmbed()) return;
      const file = join(this.userDir, '.vectors.json');
      type Cache = { model: string; items: Record<string, { h: string; v: string }> };
      let cache: Cache = { model: embedModel(), items: {} };
      try {
        if (existsSync(file)) {
          const c = JSON.parse(readFileSync(file, 'utf8')) as Cache;
          // A different embedding model is a different space: every vector in the file is meaningless, not stale.
          if (c.model === embedModel() && c.items) cache = c;
        }
      } catch {
        /* rebuild */
      }
      const want = [...this.entries.values()].filter((e) => (e.kind ?? 'skill') === 'skill');
      const hash = (t: string) => createHash('sha1').update(t).digest('hex').slice(0, 12);
      const missing: { slug: string; text: string; h: string }[] = [];
      for (const e of want) {
        const text = this.textOf(e);
        const h = hash(text);
        const hit = cache.items[e.slug];
        if (hit?.h === h) this.vecs.set(e.slug, unpackVec(hit.v));
        else missing.push({ slug: e.slug, text, h });
      }
      if (missing.length) {
        const t0 = Date.now();
        const vecs = await embed(missing.map((m) => m.text));
        if (!vecs) return; // no key, no credit, endpoint down: lexical search carries the product
        missing.forEach((m, i) => {
          this.vecs.set(m.slug, vecs[i]);
          cache.items[m.slug] = { h: m.h, v: packVec(vecs[i]) };
        });
        for (const slug of Object.keys(cache.items)) if (!this.vecs.has(slug)) delete cache.items[slug];
        try {
          writeFileSync(file, JSON.stringify({ model: embedModel(), items: cache.items }));
        } catch (e) {
          console.warn('[crew] pool index not saved:', (e as Error).message);
        }
        console.log(`[crew] pool index: ${missing.length} new, ${this.vecs.size} vectors, ${Date.now() - t0}ms`);
      }
    })().catch((e: Error) => console.warn('[crew] pool index failed:', e.message));
    return this.indexing;
  }

  /** Slugs ranked by meaning. Empty when there is no index — the caller then has only the lexical half. */
  private async vectorHits(query: string, limit: number): Promise<string[]> {
    if (!this.vecs.size) return [];
    const q = await embedOne(query);
    if (!q) return [];
    return [...this.vecs.entries()]
      .map(([slug, v]) => ({ slug, s: dot(q, v) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, limit)
      .map((x) => x.slug);
  }

  /**
   * The pool narrowed to what a brief is about: word overlap and meaning, fused by reciprocal rank. No model, so it
   * runs while the identity call is still in flight; the LLM that follows only has to choose among a dozen relevant
   * manuals instead of reading the whole catalog.
   */
  async candidates(query: string, limit = 16): Promise<LibraryEntry[]> {
    const lex = this.search(query, limit * 2).map((e) => e.slug);
    // Index building and the query embedding share a budget: a slow first call must not hold up a birth.
    const vec = await Promise.race([
      this.index().then(() => this.vectorHits(query, limit * 2)),
      new Promise<string[]>((r) => setTimeout(() => r([]), 8000)),
    ]).catch(() => [] as string[]);
    const score = new Map<string, number>();
    const add = (slugs: string[], weight: number) => slugs.forEach((slug, i) => score.set(slug, (score.get(slug) ?? 0) + weight / (10 + i)));
    add(lex, 1);
    add(vec, 1);
    return [...score.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([slug]) => this.entries.get(slug))
      .filter((e): e is Loaded => !!e)
      .map(strip);
  }

  /**
   * Which manuals does this bot carry from birth?
   *
   * A mounted manual is in its system prompt every turn for the rest of its life — that is the whole difference
   * between mounting and the per-turn recall in identity.ts. So the question is not "might this ever help" (the
   * recall answers that when the moment comes) but "is this part of the job this bot was hired for". Everything
   * that is gets mounted; there is no quota. The candidates are already relevant (fused lexical + vector), so the
   * model reads a dozen lines instead of the whole catalog and only has to draw that line.
   */
  async pickForBot(
    bot: { botId?: string; name: string; role: string; tagline?: string },
    brief: string,
    cands: LibraryEntry[],
    runtime?: ModelRuntime,
    model?: Model<Api>,
    max = 8,
  ): Promise<{ mount: string[]; connections: string[] }> {
    cands = cands.filter((e) => (e.kind ?? 'skill') === 'skill');
    if (!cands.length) return { mount: [], connections: [] };
    // No model, or the call failed: mount only what both halves of the search agree on. Cosine always returns a
    // best match — for「陪我聊聊天」it is as confident as it is for a real hit — so meaning alone may not decide what
    // a bot carries for life. Word overlap and meaning pointing at the same manual is a signal; either alone is not.
    const fallback = () => {
      const lex = new Set(this.search(`${brief} ${bot.role}`, 12).map((e) => e.slug));
      return { mount: cands.filter((e) => lex.has(e.slug) && e.category !== 'meta').slice(0, 3).map((e) => e.slug), connections: [] as string[] };
    };
    if (!runtime || !model || model.provider === 'faux') return fallback();
    const menu = cands.map((e) => `${e.slug}｜${LIBRARY_CATEGORIES[e.category] ?? e.category}｜${e.tags.slice(0, 4).join(' ')}：${e.description.slice(0, 180)}`).join('\n');
    try {
      const res = await runtime.completeSimple(model, {
        systemPrompt:
          '一个 bot 刚被创建。下面是从技能库里检索出的候选手册，请挑出要装在它身上的。\n' +
          '判断标准只有一条：这本手册是不是它这份工作的常备本事——它每次干这份活都要照着做的那几本。符合的都选上，不用控制数量；装上的手册每一轮都进它的上下文，是它人设的一部分。\n' +
          '候选是关键词检索出来的，多数时候是错的：检索只会找「沾边」，而库里本来就没有覆盖所有工作。默认答案是空数组，只有当你能说出「它职责里的这一句，做起来就是照这本手册」时才装。\n' +
          '「同一个领域」不算数：管发票报销的不需要「财务建模」，陪人练口语的不需要「课程设计」，谁都不需要「对上汇报」——领域沾边、活不是一回事的，一本都不装。\n' +
          '输出严格 JSON：{"mount":[{"slug":"…","why":"它职责里的哪一句要用到这本"},…],"connections":["服务 slug",…]}。每本都要写 why，写不出来的就是不该装的。mount 按相关度从高到低。connections 是它履行职责必须接入的外部服务，只能从这些里选：' +
          POPULAR_TOOLKITS.join(', ') +
          '；只选职责里明确需要的（管邮件→gmail，看代码仓库→github，记 Notion→notion），拿不准就不选。只输出 JSON。\n\n候选手册：\n' +
          menu,
        messages: [{ role: 'user', content: `bot 名字：${bot.name}\n简介：${bot.tagline ?? ''}\n职责：${bot.role}\n用户的第一句话：${brief}`, timestamp: Date.now() }],
      });
      noteUsage('library', bot.botId, res);
      const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
      const json = jsonFromModel<{ mount?: unknown; connections?: unknown }>(raw);
      if (!json) return fallback();
      const ok = new Set(cands.map((e) => e.slug));
      // Each pick has to name the part of the job it serves. A manual nobody can write that sentence for is the kind
      // that ends up in a bot's context for life for no reason.
      const mount = (Array.isArray(json.mount) ? json.mount : [])
        .map((x) => (typeof x === 'string' ? { slug: x, why: '' } : (x as { slug?: unknown; why?: unknown })))
        .filter((x): x is { slug: string; why: string } => typeof x?.slug === 'string' && ok.has(x.slug) && typeof x.why === 'string' && x.why.trim().length > 1)
        .map((x) => x.slug)
        .slice(0, max);
      const connections = (Array.isArray(json.connections) ? json.connections : []).filter((x): x is string => typeof x === 'string' && POPULAR_TOOLKITS.includes(x.toLowerCase())).map((x) => x.toLowerCase()).slice(0, 3);
      return { mount, connections };
    } catch (e) {
      console.warn('[crew] library pick fell back to search order:', (e as Error).message);
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
  // A SKILL.md without frontmatter is still a manual — some upstreams ship plain Markdown. Dropping it silently is
  // how one entry went missing from the pool with nothing in the log to say which.
  if (!m && !raw.trim()) return undefined;
  const fm = m ? m[1] : '';
  const body = (m ? m[2] : raw).replace(/^\n+/, '').trim();
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
  if (!m) console.warn(`[crew] library: ${category}/${dirSlug} has no frontmatter; using the manifest's own title and description`);
  // The name stays upstream's (that is what the skill is called once mounted, and what its own text refers to), but
  // the one-liner the pool shows is ours when the manifest wrote one: 一句中文 beats a paragraph of English triggers.
  return { slug: dirSlug, kind: 'skill', title, category: meta?.category ?? category, description: meta?.description || fmValue(fm, 'description') || body.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim().slice(0, 200) || '', tags: meta?.tags ?? [], source, license, body, dir };
}
