import type { CrewStore } from './store.ts';
import type { BotManager } from './bots.ts';
import { botThread, type Vigil } from './types.ts';
import { machineLink } from './machine.ts';

/**
 * 值守 (vigil): a bot's way to run a long task without blocking. It declares a goal and what to watch; the server
 * polls the check on an interval and wakes the bot only when the result changes or the check fails, so the bot can
 * react (fix a problem, note progress, or stop when the goal is met). A pure vigil with no check is a plain loop:
 * the bot is nudged each interval to carry the task forward. It is persisted on the bot, so it survives a restart.
 */
export class VigilManager {
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = new Set<string>();
  constructor(
    private store: CrewStore,
    private bots: BotManager,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), 10_000);
  }
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Begin (or replace) this bot's vigil. */
  begin(botId: string, v: Omit<Vigil, 'startedAt' | 'ticks' | 'nextAt'>): Vigil {
    const now = Date.now();
    const vigil: Vigil = { ...v, startedAt: now, ticks: 0, nextAt: now + v.everyMs };
    this.store.patchBot(botId, { vigil }, { growth: false });
    return vigil;
  }

  end(botId: string, reason: string) {
    const bot = this.store.bot(botId);
    if (!bot?.vigil) return;
    if (bot.vigil.messageId) {
      const card = this.store.message(bot.vigil.messageId)?.card;
      if (card?.type === 'vigil') this.store.patchMessage(bot.vigil.messageId, { card: { ...card, state: 'stopped', reason } });
    }
    this.store.patchBot(botId, { vigil: undefined }, { growth: false });
  }

  private async tick() {
    const now = Date.now();
    for (const bot of this.store.data.bots) {
      const v = bot.vigil;
      if (!v || v.nextAt > now || this.inFlight.has(bot.id)) continue;
      this.inFlight.add(bot.id);
      try {
        await this.runOne(bot.id, v);
      } catch (e) {
        console.warn('[crew] vigil tick failed:', (e as Error).message);
      } finally {
        this.inFlight.delete(bot.id);
      }
    }
  }

  private async runOne(botId: string, v: Vigil) {
    const ticks = v.ticks + 1;
    const overLimit = ticks > v.maxTicks;
    let result: { ok: boolean; text: string } | undefined;
    if (!overLimit && v.check) result = await this.check(v.check);

    // Decide whether this tick warrants waking the bot.
    const sig = result ? `${result.ok ? 'ok' : 'bad'}:${result.text.trim()}` : undefined;
    const changed = sig !== undefined && sig !== v.lastSig;
    const wake = overLimit || !v.check /* pure loop */ || changed || (result ? !result.ok : false);

    // Update the card and the stored vigil.
    if (v.messageId) {
      const card = this.store.message(v.messageId)?.card;
      if (card?.type === 'vigil') this.store.patchMessage(v.messageId, { card: { ...card, state: overLimit ? 'stopped' : 'running', ticks, lastAt: Date.now(), lastOk: result?.ok, last: result?.text?.slice(-500), reason: overLimit ? '到达值守上限' : card.reason } });
    }
    const next: Vigil = { ...v, ticks, lastSig: sig ?? v.lastSig, nextAt: Date.now() + v.everyMs };
    this.store.patchBot(botId, { vigil: overLimit ? undefined : next }, { growth: false });

    if (!wake) return;
    if (overLimit) {
      await this.bots.send(botId, { threadId: botThread(botId), kind: 'system', text: `【值守】「${v.goal}」已经看了 ${v.maxTicks} 次仍没结束，先停下值守，避免空转。如果还需要继续，判断一下现状，需要就重新 vigil(action=start)；否则把目前进展告诉用户。` });
      return;
    }
    const head = `【值守 · 第 ${ticks} 次】目标：${v.goal}\n盯着：${v.watching}`;
    const body = !v.check
      ? '（没有设自动检查，这是到点提醒你把这件事往前推一步。）'
      : result!.ok
        ? `刚看了一眼「${v.check.label}」，有变化：\n${result!.text.slice(0, 1500)}`
        : `「${v.check.label}」这次不正常：\n${result!.text.slice(0, 1500)}`;
    const tail = '判断一下：目标达成了就 vigil(action=stop)；有问题就动手解决；没到位就继续，什么都不用对用户说，除非需要他拍板或有值得报告的进展。';
    await this.bots.send(botId, { threadId: botThread(botId), kind: 'system', text: `${head}\n${body}\n\n${tail}` });
  }

  private async check(c: NonNullable<Vigil['check']>): Promise<{ ok: boolean; text: string }> {
    try {
      if (c.kind === 'machine') {
        const r = await machineLink().exec(c.target, { pty: true, timeoutMs: 60_000 });
        return { ok: r.code === 0 && !r.timedOut, text: `退出码 ${r.code}${r.timedOut ? '（超时）' : ''}\n${(r.out || '').trim().slice(-1500) || '（没有输出）'}` };
      }
      // http
      const res = await fetch(c.target, { signal: AbortSignal.timeout(10_000) });
      const t = (await res.text().catch(() => '')).slice(0, 400);
      return { ok: res.ok, text: `HTTP ${res.status}${t ? `\n${t}` : ''}` };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  }
}
