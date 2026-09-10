import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { CrewStore } from './store.ts';
import type { SkillStore } from './skills.ts';
import { ready as depsReady } from './deps.ts';
import type { BuildSpec, MemorySpec } from './extensions/crew-tools.ts';
import type { MemoryStore } from './memory.ts';
import type { BuildJob } from './types.ts';
import { botThread } from './types.ts';

interface Deps {
  store: CrewStore;
  skills: SkillStore;
  runtime?: ModelRuntime;
  model?: Model<Api>;
  /** called after a skill manual was written so the bot's session can pick it up */
  onSkillWritten?: (botId: string) => Promise<void>;
  /** what this bot has just equipped from the pool — the header of a manual it writes now */
  needs?: (botId: string) => { slugs: string[]; line: string } | undefined;
}

/**
 * Fold one fact into (or out of) a memory list in the background. With a model: dedupe, merge,
 * newest wins on conflict, lines stay short. Without one, or on any failure: plain add / remove, so
 * nothing the bot wanted to remember is ever lost.
 */
export async function runMemory(d: Deps & { memory: MemoryStore }, botId: string, job: BuildJob, spec: MemorySpec): Promise<void> {
  const store = d.store;
  const clearJob = () => {
    const b = store.bot(botId);
    if (b) store.patchBot(botId, { building: (b.building ?? []).filter((j) => j.id !== job.id) });
  };
  const plain = () => (spec.action === 'forget' ? void d.memory.forget(botId, spec.fact, spec.scope) : d.memory.remember(botId, spec.fact, spec.scope));
  try {
    const current = spec.scope === 'shared' ? d.memory.readShared() : d.memory.readPrivate(botId);
    if (!d.runtime || !d.model || d.model.provider === 'faux' || (spec.action === 'add' && current.length === 0)) {
      plain();
      return;
    }
    const res = await d.runtime.completeSimple(
      d.model,
      {
        systemPrompt:
          spec.action === 'add'
            ? '你在维护一个 bot 关于用户的记忆列表。给你现有列表和一条新事实：把新事实并进去——已有同义的就合并成一条，和旧的冲突以新的为准并删掉旧的，其余原样保留；每条 <=40 字，完整短句。输出严格 JSON：{"lines":["…"]}，顺序保持原有顺序，新条放末尾。只输出 JSON。'
            : '你在维护一个 bot 关于用户的记忆列表。给你现有列表和一条要忘掉的事实：删掉与之相符（同义或包含）的条目，其余原样保留，不改一个字。输出严格 JSON：{"lines":["…"]}。只输出 JSON。',
        messages: [{ role: 'user', content: `现有列表：\n${current.map((l, i) => `${i + 1}. ${l}`).join('\n')}\n\n${spec.action === 'add' ? '新事实' : '要忘掉'}：${spec.fact}`, timestamp: Date.now() }],
      },
      { maxTokens: 3000 },
    );
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
    const s = raw.indexOf('{');
    const e = raw.lastIndexOf('}');
    if (s < 0 || e < 0) throw new Error('no JSON');
    const parsed = JSON.parse(raw.slice(s, e + 1)) as { lines?: unknown };
    if (!Array.isArray(parsed.lines) || !parsed.lines.every((l) => typeof l === 'string')) throw new Error('bad lines');
    const lines = parsed.lines as string[];
    // Sanity: an add never shrinks the list by more than one merged line; a forget never grows it.
    if (spec.action === 'add' ? lines.length < current.length - 1 || lines.length > current.length + 1 : lines.length > current.length) throw new Error('implausible result');
    d.memory.replace(botId, lines, spec.scope);
  } catch (e) {
    console.warn('[crew] memory consolidation fell back to a plain write:', (e as Error).message);
    plain();
  } finally {
    clearJob();
  }
}

export const buildLabel = (spec: BuildSpec) => (spec.aspect === 'soul' ? '人设' : spec.aspect === 'instructions' ? '工作方式' : `技能「${spec.skill}」`);

/**
 * Run one self-build to completion: read the current text, rewrite it with the light model in
 * light of what happened, apply it, and leave an「进化」notice in the bot's thread. Never throws.
 */
export async function runBuild(d: Deps, botId: string, job: BuildJob, spec: BuildSpec): Promise<void> {
  const store = d.store;
  const finish = (text: string, ok: boolean) => {
    const b = store.bot(botId);
    if (b) store.patchBot(botId, { building: (b.building ?? []).filter((j) => j.id !== job.id) });
    store.addMessage({ threadId: botThread(botId), author: 'system', botId, text, ts: Date.now(), status: ok ? 'evolved' : undefined });
    if (ok) store.grow(botId, 'evolved', `进化了 · ${text}`);
  };
  try {
    const bot = store.bot(botId);
    if (!bot) return;
    if (!d.runtime || !d.model || d.model.provider === 'faux') throw new Error('没有可用的模型');
    const recent = store.data.messages
      .filter((m) => m.threadId === botThread(botId) && m.author !== 'system' && m.text)
      .slice(-24)
      .map((m) => `${m.author === 'user' ? '用户' : bot.name}：${m.text.replace(/\s+/g, ' ').slice(0, 300)}`)
      .join('\n');
    const askOnce = async (system: string, user: string, maxTokens: number) => {
      const res = await d.runtime!.completeSimple(d.model!, { systemPrompt: system, messages: [{ role: 'user', content: user, timestamp: Date.now() }] }, { maxTokens });
      const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
      const s = raw.indexOf('{');
      const e = raw.lastIndexOf('}');
      if (s < 0 || e < 0) throw new Error(`模型没有返回 JSON（stop=${res.stopReason}，${raw.length} 字：${raw.slice(0, 160).replace(/\n/g, ' ')}）`);
      return JSON.parse(raw.slice(s, e + 1)) as Record<string, string>;
    };
    // The light model occasionally answers in prose; one retry with a sharper reminder fixes most of it.
    const ask = async (system: string, user: string, maxTokens = 4000) => {
      try {
        return await askOnce(system, user, maxTokens);
      } catch (e) {
        console.warn('[crew] build: retrying after', (e as Error).message);
        return askOnce(`${system}\n\n注意：上一次你没有输出 JSON。这次第一个字符必须是 {，最后一个字符必须是 }。`, user, maxTokens);
      }
    };
    const ctx = `bot 名字：${bot.name}\n职责与工作方式：${bot.role}\n人设：${bot.soul || '（空）'}\n技能：${bot.skills.join('、') || '（无）'}\n\n触发：${spec.trigger}\n想要的改变：${spec.change}\n\n最近的对话：\n${recent || '（无）'}`;

    if (spec.aspect === 'soul') {
      const r = await ask(
        '一个长期服务用户的 bot 决定改写自己的人设（性格、说话风格、待人方式）。根据触发事件和它想要的改变，重写人设：保留仍然成立的部分，改掉被纠正的部分，2-3 句，中文，具体、有个性，不要泛泛的「专业热情」。输出严格 JSON：{"soul":"新的人设全文","summary":"一句话（<=30 字）说明变了什么，如「不再客套，先给结论」"}。只输出 JSON。',
        ctx,
      );
      if (!r.soul?.trim()) throw new Error('没有生成人设');
      store.patchBot(botId, { soul: r.soul.trim().slice(0, 400) }, { growth: false });
      finish(`人设：${r.summary || '已更新'}`, true);
      return;
    }
    if (spec.aspect === 'instructions') {
      const r = await ask(
        '一个长期服务用户的 bot 决定改写自己的职责与工作方式。根据触发事件和它想要的改变，重写这段文字：以「我」为用户视角，2-4 句，中文，写清管什么、按什么流程做、做到哪一步要问用户；保留仍然成立的边界，改掉和现实对不上的部分。输出严格 JSON：{"role":"新的职责与工作方式全文","summary":"一句话（<=30 字）说明变了什么"}。只输出 JSON。',
        ctx,
      );
      if (!r.role?.trim()) throw new Error('没有生成职责');
      store.patchBot(botId, { role: r.role.trim().slice(0, 800) }, { growth: false });
      finish(`工作方式：${r.summary || '已更新'}`, true);
      return;
    }
    // skill
    const name = spec.skill!;
    const existing = d.skills.get(name);
    const r = await ask(
      '一个长期服务用户的 bot 决定给自己写（或改写）一份技能手册。手册是它以后执行同类任务时读的操作步骤，Markdown。根据触发事件、想要的改变和最近的对话，写出手册。输出严格 JSON：{"description":"一句话，<=60 字，这个技能做什么、什么时候用","body":"Markdown 正文：## 目的 / ## 何时使用 / ## 步骤（编号，具体到可执行，写进这次学到的教训） / ## 需要用户确认的点 / ## 注意事项。300-700 字，中文。","summary":"一句话（<=30 字）说明这份手册新增或改了什么"}。只输出 JSON。',
      `${ctx}\n\n技能名：${name}\n${existing ? `现有手册：\n${existing.body}` : '（还没有这份手册）'}`,
      8000,
    );
    if (!r.body?.trim()) throw new Error('没有生成手册');
    // What the manual stands on is the runtime's line to write, not the model's: the bot writes the steps, we write
    // what has to be in place before step 1, from what it actually equipped. Anything it invented up top is dropped.
    let body = r.body.trim();
    while (/^(?:>\s*)?需要：/.test(body)) body = body.replace(/^[^\n]*\n?/, '').trimStart();
    const needs = d.needs?.(botId);
    d.skills.write(name, r.description ?? '', needs ? `> 需要：${needs.line}\n\n${body}` : body, needs ? { needs: needs.slugs } : undefined);
    // A manual the bot wrote for itself gets the same treatment as one from the library: whatever it says to run,
    // install it now rather than at the worst possible moment.
    const req = d.skills.requiresOf(name);
    if (req && (req.pip?.length || req.npm?.length || req.bin?.length)) {
      const r = await depsReady(req, `skill:${name}`).catch((e: Error) => ({ ok: false, note: e.message }) as { ok: boolean; note?: string });
      if (!r.ok) console.warn(`[crew] 技能「${name}」的依赖：${r.note ?? ''}`);
    }
    const cur = store.bot(botId);
    if (cur && !cur.skills.includes(name)) store.patchBot(botId, { skills: [...cur.skills, name] }, { growth: false });
    await d.onSkillWritten?.(botId);
    finish(`技能「${name}」：${r.summary || (existing ? '已改写' : '已新建')}`, true);
  } catch (e) {
    console.warn('[crew] build failed:', (e as Error).message);
    finish(`${job.label}这次没进化成功：${(e as Error).message}`, false);
  }
}
