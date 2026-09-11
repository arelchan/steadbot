import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { CrewStore } from './store.ts';
import type { SkillStore } from './skills.ts';
import { ready as depsReady } from './deps.ts';
import type { BuildSpec } from './extensions/crew-tools.ts';
import type { BuildJob } from './types.ts';
import { botThread } from './types.ts';

interface Deps {
  store: CrewStore;
  /** The bot's own manuals: a build rewrites what this bot carries, not a copy some other bot also points at. */
  skills: (botId: string) => SkillStore;
  runtime?: ModelRuntime;
  model?: Model<Api>;
  /** called after a skill manual was written so the bot's session can pick it up */
  onSkillWritten?: (botId: string) => Promise<void>;
  /** what this bot has just equipped from the pool — the header of a manual it writes now */
  needs?: (botId: string) => { slugs: string[]; line: string } | undefined;
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
    const existing = d.skills(botId).get(name);
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
    d.skills(botId).write(name, r.description ?? '', needs ? `> 需要：${needs.line}\n\n${body}` : body, needs ? { needs: needs.slugs } : undefined);
    // A manual the bot wrote for itself gets the same treatment as one from the library: whatever it says to run,
    // install it now rather than at the worst possible moment.
    const req = d.skills(botId).requiresOf(name);
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

/**
 * Memory turning into ability.
 *
 * The engine clusters a bot's own cases and, when a cluster hardens, writes one `agent_skill` —
 * "this is how you do this kind of work". That is the only mechanical signal the product has that a
 * bot learned something without being told, and it is rare on purpose: a case is only kept when a
 * trajectory went sideways and got fixed. So a new one is worth a build, and it takes the same path
 * a user's correction takes — rewritten by the light model, applied to the bot, an「进化」notice in its
 * thread — which is what makes it visible, editable and revertable instead of a silent mutation.
 */
export async function pickupSkills(
  d: { store: CrewStore; botsDir: string; skillsOf: (botId: string) => Promise<{ name: string; text: string; at: string }[]>; build: (botId: string, spec: BuildSpec) => Promise<unknown> },
  botId: string,
): Promise<void> {
  try {
    const seenFile = join(d.botsDir, botId, '.skills-seen.json');
    const seen: Record<string, string> = existsSync(seenFile) ? (JSON.parse(readFileSync(seenFile, 'utf8')) as Record<string, string>) : {};
    const have = await d.skillsOf(botId);
    if (!have.length) return;
    const fresh = have.filter((s) => s.name && s.text.length > 20 && seen[s.name] !== (s.at || '1'));
    // Record everything first: a build that fails should not make this fire again on the next flush.
    const next: Record<string, string> = {};
    for (const s of have) if (s.name) next[s.name] = s.at || '1';
    mkdirSync(join(d.botsDir, botId), { recursive: true });
    writeFileSync(seenFile, JSON.stringify(next, null, 2) + '\n');
    if (!fresh.length) return;
    // One at a time. Two rewrites of the same working instructions in one pass would fight each other.
    const s = fresh[0];
    const bot = d.store.bot(botId);
    if (!bot) return;
    console.log(`[crew] 记忆：${bot.name} 攒出一条做法「${s.name}」，排一次 build`);
    await d.build(botId, {
      aspect: 'instructions',
      trigger: `同类活反复干过，记忆里攒出了一条做法「${s.name}」`,
      change: `把这条做法写进你的工作方式，用你自己的话，别照抄：\n${s.text.slice(0, 1200)}`,
    });
  } catch (e) {
    console.warn('[crew] 记忆：做法转 build 失败 —', (e as Error).message);
  }
}
