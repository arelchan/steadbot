import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { imageContent } from './vision.ts';

/*
 * Hands: a vision model that works the computer the way a person does — looks at the screen, decides on one action,
 * does it, looks again. This is the second GUI mode next to Playwright's text snapshots: the first is cheap and exact
 * for ordinary web pages; this one is for what snapshots cannot reach — canvas editors, drag-and-drop, desktop
 * software, pages built out of pictures. The model is `guiModel` in config (meant for a strong computer-use model
 * such as GPT-6); it sees only the screen, never the conversation, and reports back in words.
 *
 * The same loop runs on the cloud machine's shared X display (xdotool + ImageMagick) and on a Mac where the bots
 * run locally (screencapture + cliclick). One operation holds the screen at a time: the screen is one thing.
 */

const MAX_W = 1280;
const STEP_PAUSE_MS = 800;

export interface Hands {
  runtime: ModelRuntime;
  model: Model<Api>;
}

interface Shot {
  file: string;
  /** screenshot pixel size */
  w: number;
  h: number;
  /** screenshot pixel → pointer coordinate */
  scale: number;
}

type Action =
  | { type: 'click' | 'double_click' | 'right_click'; x: number; y: number }
  | { type: 'type'; text: string }
  | { type: 'key'; keys: string }
  | { type: 'scroll'; x: number; y: number; direction: 'up' | 'down' | 'left' | 'right'; amount?: number }
  | { type: 'drag'; x: number; y: number; x2: number; y2: number }
  | { type: 'wait'; seconds?: number }
  | { type: 'done'; summary: string }
  | { type: 'fail'; reason: string };

const exec = (cmd: string, args: string[], env?: NodeJS.ProcessEnv, timeout = 20_000) =>
  new Promise<string>((resolve, reject) => {
    execFile(cmd, args, { env: { ...process.env, ...(env ?? {}) }, timeout, maxBuffer: 32 << 20 }, (err, out, errOut) => (err ? reject(new Error((errOut?.toString().trim() || err.message).slice(-300))) : resolve(out.toString())));
  });

const which = async (bin: string) => {
  try {
    await exec('/bin/sh', ['-lc', `command -v ${bin}`]);
    return true;
  } catch {
    return false;
  }
};

/** Key names the model tends to write → what the driver takes. */
const KEY_ALIAS: Record<string, string> = { enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', backspace: 'BackSpace', delete: 'Delete', up: 'Up', down: 'Down', left: 'Left', right: 'Right', home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', cmd: 'ctrl', command: 'ctrl', meta: 'ctrl', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift' };
const normKeys = (s: string) =>
  s
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => KEY_ALIAS[k.toLowerCase()] ?? (k.length === 1 ? k : k))
    .join('+');

/** A driver for one screen: where the pointer goes and what the screenshot is. */
interface Driver {
  shot(dir: string, name: string): Promise<Shot>;
  click(x: number, y: number, kind: 'click' | 'double_click' | 'right_click'): Promise<void>;
  type(text: string): Promise<void>;
  key(keys: string): Promise<void>;
  scroll(x: number, y: number, direction: 'up' | 'down' | 'left' | 'right', amount: number): Promise<void>;
  drag(x: number, y: number, x2: number, y2: number): Promise<void>;
}

function xDriver(display: string): Driver {
  const env = { DISPLAY: display };
  const move = (x: number, y: number) => exec('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))], env);
  return {
    async shot(dir, name) {
      const file = join(dir, `${name}.png`);
      await exec('import', ['-display', display, '-window', 'root', '-resize', `${MAX_W}x>`, file], env);
      const [w, h] = (await exec('identify', ['-format', '%w %h', file])).trim().split(' ').map(Number);
      const geom = (await exec('xdotool', ['getdisplaygeometry'], env)).trim().split(' ').map(Number);
      return { file, w, h, scale: geom[0] && w ? geom[0] / w : 1 };
    },
    async click(x, y, kind) {
      await move(x, y);
      await exec('xdotool', kind === 'right_click' ? ['click', '3'] : kind === 'double_click' ? ['click', '--repeat', '2', '--delay', '80', '1'] : ['click', '1'], env);
    },
    async type(text) {
      await exec('xdotool', ['type', '--delay', '25', '--', text], env, 60_000);
    },
    async key(keys) {
      await exec('xdotool', ['key', '--clearmodifiers', normKeys(keys)], env);
    },
    async scroll(x, y, direction, amount) {
      await move(x, y);
      const button = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7';
      await exec('xdotool', ['click', '--repeat', String(Math.max(1, Math.min(20, amount))), '--delay', '30', button], env);
    },
    async drag(x, y, x2, y2) {
      await move(x, y);
      await exec('xdotool', ['mousedown', '1'], env);
      await exec('xdotool', ['mousemove', '--sync', String(Math.round((x + x2) / 2)), String(Math.round((y + y2) / 2))], env);
      await exec('xdotool', ['mousemove', '--sync', String(Math.round(x2)), String(Math.round(y2))], env);
      await exec('xdotool', ['mouseup', '1'], env);
    },
  };
}

function macDriver(): Driver {
  const cc = (args: string[]) => exec('cliclick', args);
  return {
    async shot(dir, name) {
      const file = join(dir, `${name}.png`);
      await exec('screencapture', ['-x', '-C', file]);
      const pw = Number((await exec('sips', ['-g', 'pixelWidth', file])).match(/pixelWidth:\s*(\d+)/)?.[1] ?? 0);
      // Logical screen width in points; the screenshot is in device pixels (2× on Retina).
      const bounds = (await exec('osascript', ['-e', 'tell application "Finder" to get bounds of window of desktop'])).trim().split(',').map((s) => Number(s.trim()));
      const points = bounds[2] || pw;
      await exec('sips', ['-Z', String(MAX_W), file]);
      const [w, h] = (await exec('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file])).match(/pixel(?:Width|Height):\s*(\d+)/g)!.map((s) => Number(s.replace(/\D/g, '')));
      return { file, w, h, scale: points / w };
    },
    async click(x, y, kind) {
      await cc([`${kind === 'right_click' ? 'rc' : kind === 'double_click' ? 'dc' : 'c'}:${Math.round(x)},${Math.round(y)}`]);
    },
    async type(text) {
      await cc([`t:${text}`]);
    },
    async key(keys) {
      const parts = keys.split('+').map((k) => k.trim().toLowerCase());
      const mods = parts.filter((k) => ['cmd', 'command', 'meta', 'ctrl', 'control', 'alt', 'option', 'shift'].includes(k)).map((k) => (k === 'command' || k === 'meta' ? 'cmd' : k === 'control' ? 'ctrl' : k === 'option' ? 'alt' : k));
      const main = parts.find((k) => !mods.includes(k) && !['command', 'meta', 'control', 'option'].includes(k)) ?? '';
      const kp: Record<string, string> = { enter: 'return', return: 'return', esc: 'esc', escape: 'esc', tab: 'tab', space: 'space', backspace: 'delete', delete: 'fwd-delete', up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right', home: 'home', end: 'end', pageup: 'page-up', pagedown: 'page-down' };
      const args: string[] = [];
      if (mods.length) args.push(`kd:${mods.join(',')}`);
      if (main) args.push(kp[main] ? `kp:${kp[main]}` : `t:${main}`);
      if (mods.length) args.push(`ku:${mods.join(',')}`);
      await cc(args);
    },
    async scroll(x, y, direction, amount) {
      // cliclick has no wheel; arrow keys after a click are the honest fallback.
      await cc([`c:${Math.round(x)},${Math.round(y)}`]);
      const key = direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : direction === 'left' ? 'arrow-left' : 'arrow-right';
      await cc(Array.from({ length: Math.max(1, Math.min(10, amount)) }, () => `kp:${key}`));
    },
    async drag(x, y, x2, y2) {
      await cc([`dd:${Math.round(x)},${Math.round(y)}`, `dm:${Math.round((x + x2) / 2)},${Math.round((y + y2) / 2)}`, `du:${Math.round(x2)},${Math.round(y2)}`]);
    },
  };
}

export interface OperateResult {
  ok: boolean;
  summary: string;
  steps: number;
  /** the last screenshot, for the bot to `see` */
  lastShot?: string;
  log: string;
}

const SYSTEM = `你在操作一台电脑，通过截图看屏幕，一次只做一个动作。每次回复只输出一个 JSON 对象，不要别的文字：
{"thought":"一句话：看到了什么、下一步为什么这么做","action":{...}}
action 只能是下面之一（坐标以本次截图的像素为准，左上角是 (0,0)）：
{"type":"click","x":..,"y":..} {"type":"double_click","x":..,"y":..} {"type":"right_click","x":..,"y":..}
{"type":"type","text":"..."}（在已聚焦的输入框里输入；要换行用 key Return）
{"type":"key","keys":"ctrl+l"}（组合键用 + 连接：Return、Escape、Tab、BackSpace、ctrl+a、ctrl+c…）
{"type":"scroll","x":..,"y":..,"direction":"down","amount":3}
{"type":"drag","x":..,"y":..,"x2":..,"y2":..}
{"type":"wait","seconds":2}（页面在加载）
{"type":"done","summary":"做完了什么、结果是什么、值得注意的事"}
{"type":"fail","reason":"为什么做不下去、卡在哪、需要人做什么"}
规则：先看清再点，点之前确认目标在截图里；同一个动作重复两次没效果就换办法；需要登录、验证码、付款、不可逆的删除，用 fail 说明并停下；不要输入任何密码或密钥；完成目标后立刻 done，不做多余的事。`;

let queue: Promise<unknown> = Promise.resolve();
/** Who holds the screen right now, for the tool's own message. */
export let screenHeldBy: string | undefined;

/**
 * Run one goal to completion (or failure, or the step cap) on a screen. `display` is the X display on Linux;
 * on macOS the Mac's own screen is used. Screenshots and a step log go under `outDir`.
 */
export async function operate(hands: Hands, goal: string, opts: { display?: string; outDir: string; context?: string; maxSteps?: number; holder: string }): Promise<OperateResult> {
  const run = async (): Promise<OperateResult> => {
    screenHeldBy = opts.holder;
    try {
      return await operateNow(hands, goal, opts);
    } finally {
      screenHeldBy = undefined;
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => undefined);
  return p;
}

/** Whether this machine can run the loop at all, and why not. */
export async function guiCapability(display?: string): Promise<{ ok: boolean; note?: string }> {
  if (platform() === 'linux') {
    if (!display) return { ok: false, note: '电脑没开' };
    for (const bin of ['xdotool', 'import', 'identify']) if (!(await which(bin))) return { ok: false, note: `这台机器上没装 ${bin}（用最新镜像重装一次就有）` };
    return { ok: true };
  }
  if (platform() === 'darwin') {
    if (!(await which('cliclick'))) return { ok: false, note: '这台 Mac 上没装 cliclick（brew install cliclick），装了才能替你点鼠标' };
    return { ok: true };
  }
  return { ok: false, note: '这个系统上还不支持操作屏幕' };
}

async function operateNow(hands: Hands, goal: string, opts: { display?: string; outDir: string; context?: string; maxSteps?: number }): Promise<OperateResult> {
  const driver = platform() === 'darwin' ? macDriver() : xDriver(opts.display ?? ':100');
  const maxSteps = Math.max(1, Math.min(60, opts.maxSteps ?? 25));
  const dir = join(opts.outDir, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  mkdirSync(dir, { recursive: true });
  const history: string[] = [];
  const log: string[] = [`# ${goal}`, ''];
  let lastShot: string | undefined;
  let stuck = 0;
  let lastAction = '';
  for (let i = 1; i <= maxSteps; i++) {
    const shot = await driver.shot(dir, `step-${String(i).padStart(2, '0')}`);
    lastShot = shot.file;
    const prompt = [
      `目标：${goal}`,
      opts.context ? `背景：${opts.context}` : '',
      history.length ? `已经做过（最近 ${Math.min(history.length, 8)} 步）：\n${history.slice(-8).join('\n')}` : '这是第一步。',
      `截图尺寸 ${shot.w}×${shot.h}。第 ${i}/${maxSteps} 步。`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const res = await hands.runtime.completeSimple(hands.model, {
      systemPrompt: SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, imageContent(shot.file, 'image/png')], timestamp: Date.now() }],
    });
    const raw = res.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
    const parsed = parseStep(raw);
    if (!parsed) {
      log.push(`## ${i}\n模型没有给出可执行的动作：${raw.slice(0, 300)}`);
      history.push(`${i}. （模型输出无法解析，重试）`);
      stuck++;
      if (stuck >= 3) return finish(false, '模型连续三次没有给出可执行的动作', i, lastShot, log, dir);
      continue;
    }
    const { thought, action } = parsed;
    const desc = describe(action);
    log.push(`## ${i}\n${thought}\n→ ${desc}`);
    history.push(`${i}. ${desc}${thought ? `（${thought.slice(0, 80)}）` : ''}`);
    if (action.type === 'done') return finish(true, action.summary, i, lastShot, log, dir);
    if (action.type === 'fail') return finish(false, action.reason, i, lastShot, log, dir);
    // The same action twice in a row with nothing changing is a loop; three times and we stop.
    stuck = desc === lastAction ? stuck + 1 : 0;
    lastAction = desc;
    if (stuck >= 3) return finish(false, `同一个动作重复了三次没有进展：${desc}`, i, lastShot, log, dir);
    try {
      await perform(driver, action, shot.scale);
    } catch (e) {
      log.push(`（执行失败：${(e as Error).message}）`);
      history.push(`   执行失败：${(e as Error).message.slice(0, 120)}`);
    }
    await new Promise((r) => setTimeout(r, action.type === 'wait' ? Math.min(10, action.seconds ?? 2) * 1000 : STEP_PAUSE_MS));
  }
  const shot = await driver.shot(dir, 'step-end').catch(() => undefined);
  return finish(false, `${maxSteps} 步内没有做完`, maxSteps, shot?.file ?? lastShot, log, dir);
}

function finish(ok: boolean, summary: string, steps: number, lastShot: string | undefined, log: string[], dir: string): OperateResult {
  log.push('', ok ? `✔ ${summary}` : `✘ ${summary}`);
  const file = join(dir, 'log.md');
  writeFileSync(file, log.join('\n') + '\n');
  return { ok, summary, steps, lastShot: lastShot && existsSync(lastShot) ? lastShot : undefined, log: file };
}

function parseStep(raw: string): { thought: string; action: Action } | undefined {
  const s = raw.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) return undefined;
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { thought?: string; action?: Partial<Action> & { type?: string } };
    const act = o.action;
    if (!act?.type) return undefined;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
    switch (act.type) {
      case 'click':
      case 'double_click':
      case 'right_click': {
        const x = n((act as { x?: unknown }).x);
        const y = n((act as { y?: unknown }).y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
        return { thought: o.thought ?? '', action: { type: act.type, x, y } };
      }
      case 'type':
        return { thought: o.thought ?? '', action: { type: 'type', text: String((act as { text?: unknown }).text ?? '') } };
      case 'key':
        return { thought: o.thought ?? '', action: { type: 'key', keys: String((act as { keys?: unknown }).keys ?? (act as { key?: unknown }).key ?? '') } };
      case 'scroll': {
        const a2 = act as { x?: unknown; y?: unknown; direction?: unknown; amount?: unknown };
        return { thought: o.thought ?? '', action: { type: 'scroll', x: n(a2.x) || 640, y: n(a2.y) || 400, direction: (['up', 'down', 'left', 'right'].includes(String(a2.direction)) ? String(a2.direction) : 'down') as 'up' | 'down' | 'left' | 'right', amount: n(a2.amount) || 3 } };
      }
      case 'drag': {
        const a2 = act as { x?: unknown; y?: unknown; x2?: unknown; y2?: unknown };
        return { thought: o.thought ?? '', action: { type: 'drag', x: n(a2.x), y: n(a2.y), x2: n(a2.x2), y2: n(a2.y2) } };
      }
      case 'wait':
        return { thought: o.thought ?? '', action: { type: 'wait', seconds: n((act as { seconds?: unknown }).seconds) || 2 } };
      case 'done':
        return { thought: o.thought ?? '', action: { type: 'done', summary: String((act as { summary?: unknown }).summary ?? o.thought ?? '完成') } };
      case 'fail':
        return { thought: o.thought ?? '', action: { type: 'fail', reason: String((act as { reason?: unknown }).reason ?? o.thought ?? '做不下去') } };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

function describe(a: Action): string {
  switch (a.type) {
    case 'click':
    case 'double_click':
    case 'right_click':
      return `${a.type} (${Math.round(a.x)},${Math.round(a.y)})`;
    case 'type':
      return `type "${a.text.length > 40 ? a.text.slice(0, 40) + '…' : a.text}"`;
    case 'key':
      return `key ${a.keys}`;
    case 'scroll':
      return `scroll ${a.direction} ×${a.amount ?? 3} @(${Math.round(a.x)},${Math.round(a.y)})`;
    case 'drag':
      return `drag (${Math.round(a.x)},${Math.round(a.y)})→(${Math.round(a.x2)},${Math.round(a.y2)})`;
    case 'wait':
      return `wait ${a.seconds ?? 2}s`;
    case 'done':
      return `done: ${a.summary}`;
    case 'fail':
      return `fail: ${a.reason}`;
  }
}

async function perform(d: Driver, a: Action, scale: number) {
  const s = (v: number) => v * scale;
  switch (a.type) {
    case 'click':
    case 'double_click':
    case 'right_click':
      return d.click(s(a.x), s(a.y), a.type);
    case 'type':
      return a.text ? d.type(a.text) : undefined;
    case 'key':
      return a.keys ? d.key(a.keys) : undefined;
    case 'scroll':
      return d.scroll(s(a.x), s(a.y), a.direction, a.amount ?? 3);
    case 'drag':
      return d.drag(s(a.x), s(a.y), s(a.x2), s(a.y2));
    default:
      return undefined;
  }
}
