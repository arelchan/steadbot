import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { platform } from 'node:os';
import { join } from 'node:path';
import { StringEnum, type Api, type Model, type Tool } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { imageContent } from './vision.ts';

/*
 * Hands: a vision model that works the computer the way a person does — looks at the screen, decides on one action,
 * does it, looks again. This is the second GUI mode next to Playwright's text snapshots: the first is cheap and exact
 * for ordinary web pages; this one is for what snapshots cannot reach — canvas editors, drag-and-drop, desktop
 * software, pages built out of pictures. The model is `guiModel` in config; it sees only the screen, never the
 * conversation, and reports back in words.
 *
 * The same loop runs on the cloud machine's shared X display (xdotool + ImageMagick) and on a Mac where the bots
 * run locally (screencapture + cliclick). One operation holds the screen at a time: the screen is one thing.
 *
 * **The action vocabulary is OpenAI's computer-use vocabulary, deliberately.** `ComputerAction` and the driver below
 * are the same click / double_click / move / scroll / type / keypress / drag / wait / screenshot set, with the same
 * field names (`button`, `scroll_x`, `keys[]`, `path[]`), so the executor is already the executor a native
 * computer-use model would need. What is ours is only how the action is *obtained*: a tool call against a schema,
 * because no model reachable through OpenRouter today accepts the `computer_use_preview` tool (verified 2026-09-10:
 * the endpoint and the tool schema are there, GPT-6 rejects the tool, Anthropic's own tool type is dropped).
 * When a model does accept it, the swap is one function — ask the model for the next action — plus returning the
 * screenshot as `computer_call_output` and acknowledging `pending_safety_checks`. Nothing else here changes.
 */

// Screenshots go to the model at the screen's own width (desktop.ts: 1440), so nothing is resampled — small UI
// text is where a GUI model actually fails. Larger screens (a Retina Mac) still come down to this. Measured on
// gpt-6-astra: 1280×800 = 1217 prompt tokens, 1440×900 = 1583, about half a cent more per step.
const MAX_W = 1440;
/** A person's hand on the same screen: the pointer sits somewhere our own last action did not put it. */
const HUMAN_STILL_MS = 4000;
const HUMAN_WAIT_MAX_MS = 120_000;
const STEP_PAUSE_MS = 800;
/** Fraction of pixels that has to differ before the screen counts as having changed. */
const CHANGED_RATIO = 0.002;
/** Pixels of scroll per wheel click, the usual browser step. */
const WHEEL_PX = 100;

export interface Hands {
  runtime: ModelRuntime;
  model: Model<Api>;
}

interface Shot {
  file: string;
  /** screenshot pixel size; this is the display size the model is told about */
  w: number;
  h: number;
  /** screenshot pixel → pointer coordinate */
  scale: number;
}

export type MouseButton = 'left' | 'right' | 'middle' | 'wheel' | 'back' | 'forward';

/** OpenAI's computer-use action set, field for field. Coordinates are in screenshot pixels. */
export type ComputerAction =
  | { type: 'click'; button: MouseButton; x: number; y: number }
  | { type: 'double_click'; x: number; y: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'scroll'; x: number; y: number; scroll_x: number; scroll_y: number }
  | { type: 'type'; text: string }
  | { type: 'keypress'; keys: string[] }
  | { type: 'drag'; path: { x: number; y: number }[] }
  | { type: 'wait'; seconds?: number }
  | { type: 'screenshot' };

/**
 * What the loop can receive. The native protocol ends a run by returning a message instead of a computer_call;
 * until we speak it, the model says so with these two, the only additions to the vocabulary above.
 */
type Step = { type: 'done'; summary: string } | { type: 'fail'; reason: string } | ComputerAction;

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

/** Key names as computer-use models write them (ENTER, ARROWUP, CMD…) → X keysyms. */
const X_KEY: Record<string, string> = {
  enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape', tab: 'Tab', space: 'space', backspace: 'BackSpace', delete: 'Delete', del: 'Delete',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right', arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  home: 'Home', end: 'End', pageup: 'Prior', pagedown: 'Next', insert: 'Insert', capslock: 'Caps_Lock',
  // No Mac keyboard on a Linux desktop: a model asking for Cmd means the platform's own modifier.
  cmd: 'ctrl', command: 'ctrl', meta: 'ctrl', super: 'ctrl', win: 'ctrl', ctrl: 'ctrl', control: 'ctrl', alt: 'alt', option: 'alt', shift: 'shift',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
};
const MAC_KEY: Record<string, string> = {
  enter: 'return', return: 'return', esc: 'esc', escape: 'esc', tab: 'tab', space: 'space', backspace: 'delete', delete: 'fwd-delete', del: 'fwd-delete',
  up: 'arrow-up', down: 'arrow-down', left: 'arrow-left', right: 'arrow-right', arrowup: 'arrow-up', arrowdown: 'arrow-down', arrowleft: 'arrow-left', arrowright: 'arrow-right',
  home: 'home', end: 'end', pageup: 'page-up', pagedown: 'page-down',
};
const MAC_MODS = new Set(['cmd', 'command', 'meta', 'super', 'win', 'ctrl', 'control', 'alt', 'option', 'shift']);
const macMod = (k: string) => (k === 'command' || k === 'meta' || k === 'super' || k === 'win' ? 'cmd' : k === 'control' ? 'ctrl' : k === 'option' ? 'alt' : k);

/** A driver for one screen. The methods are the action set, one to one. */
interface Driver {
  shot(dir: string, name: string): Promise<Shot>;
  /** Where the pointer is right now. Undefined when the platform cannot say — then nobody is presumed present. */
  pointer(): Promise<{ x: number; y: number } | undefined>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number, button: MouseButton): Promise<void>;
  doubleClick(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  keypress(keys: string[]): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  drag(path: { x: number; y: number }[]): Promise<void>;
}

function xDriver(display: string): Driver {
  const env = { DISPLAY: display };
  const BUTTON: Record<MouseButton, string> = { left: '1', middle: '2', wheel: '2', right: '3', back: '8', forward: '9' };
  const move = (x: number, y: number) => exec('xdotool', ['mousemove', '--sync', String(Math.round(x)), String(Math.round(y))], env);
  const wheel = (button: string, clicks: number) => exec('xdotool', ['click', '--repeat', String(Math.max(1, Math.min(20, clicks))), '--delay', '30', button], env);
  return {
    async shot(dir, name) {
      const file = join(dir, `${name}.png`);
      await exec('import', ['-display', display, '-window', 'root', '-resize', `${MAX_W}x>`, file], env);
      const [w, h] = (await exec('identify', ['-format', '%w %h', file])).trim().split(' ').map(Number);
      const geom = (await exec('xdotool', ['getdisplaygeometry'], env)).trim().split(' ').map(Number);
      return { file, w, h, scale: geom[0] && w ? geom[0] / w : 1 };
    },
    async pointer() {
      try {
        const out = await exec('xdotool', ['getmouselocation', '--shell'], env, 5000);
        const x = Number(/X=(\d+)/.exec(out)?.[1]);
        const y = Number(/Y=(\d+)/.exec(out)?.[1]);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      } catch {
        return undefined;
      }
    },
    async move(x, y) {
      await move(x, y);
    },
    async click(x, y, button) {
      await move(x, y);
      await exec('xdotool', ['click', BUTTON[button] ?? '1'], env);
    },
    async doubleClick(x, y) {
      await move(x, y);
      await exec('xdotool', ['click', '--repeat', '2', '--delay', '80', '1'], env);
    },
    async type(text) {
      await exec('xdotool', ['type', '--delay', '25', '--', text], env, 60_000);
    },
    async keypress(keys) {
      const combo = keys
        .map((k) => X_KEY[k.trim().toLowerCase()] ?? k.trim())
        .filter(Boolean)
        .join('+');
      if (combo) await exec('xdotool', ['key', '--clearmodifiers', combo], env);
    },
    async scroll(x, y, dx, dy) {
      await move(x, y);
      if (dy) await wheel(dy > 0 ? '5' : '4', Math.round(Math.abs(dy) / WHEEL_PX) || 1);
      if (dx) await wheel(dx > 0 ? '7' : '6', Math.round(Math.abs(dx) / WHEEL_PX) || 1);
    },
    async drag(path) {
      if (path.length < 2) return;
      await move(path[0].x, path[0].y);
      await exec('xdotool', ['mousedown', '1'], env);
      for (const p of path.slice(1)) await move(p.x, p.y);
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
    async pointer() {
      try {
        const [x, y] = (await exec('cliclick', ['p'], undefined, 5000)).trim().split(',').map(Number);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
      } catch {
        return undefined;
      }
    },
    async move(x, y) {
      await cc([`m:${Math.round(x)},${Math.round(y)}`]);
    },
    async click(x, y, button) {
      await cc([`${button === 'right' ? 'rc' : 'c'}:${Math.round(x)},${Math.round(y)}`]);
    },
    async doubleClick(x, y) {
      await cc([`dc:${Math.round(x)},${Math.round(y)}`]);
    },
    async type(text) {
      await cc([`t:${text}`]);
    },
    async keypress(keys) {
      const low = keys.map((k) => k.trim().toLowerCase());
      const mods = [...new Set(low.filter((k) => MAC_MODS.has(k)).map(macMod))];
      const main = low.find((k) => !MAC_MODS.has(k)) ?? '';
      const args: string[] = [];
      if (mods.length) args.push(`kd:${mods.join(',')}`);
      if (main) args.push(MAC_KEY[main] ? `kp:${MAC_KEY[main]}` : `t:${main}`);
      if (mods.length) args.push(`ku:${mods.join(',')}`);
      if (args.length) await cc(args);
    },
    async scroll(x, y, dx, dy) {
      // cliclick has no wheel; arrow keys after a click are the honest fallback.
      await cc([`c:${Math.round(x)},${Math.round(y)}`]);
      const steps = Math.max(1, Math.min(10, Math.round(Math.abs(dy || dx) / WHEEL_PX) || 1));
      const key = dy ? (dy > 0 ? 'arrow-down' : 'arrow-up') : dx > 0 ? 'arrow-right' : 'arrow-left';
      await cc(Array.from({ length: steps }, () => `kp:${key}`));
    },
    async drag(path) {
      if (path.length < 2) return;
      const p = (i: number) => `${Math.round(path[i].x)},${Math.round(path[i].y)}`;
      await cc([`dd:${p(0)}`, ...path.slice(1, -1).map((_, i) => `dm:${p(i + 1)}`), `du:${p(path.length - 1)}`]);
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

/**
 * The one tool the hands may call: the native action set as a schema, so a provider that validates arguments does
 * the job `computer_use_preview` would do. Coordinates are in the pixels of the screenshot just sent.
 */
const ACT_TOOL: Tool = {
  name: 'computer',
  description: '在屏幕上做一个动作，或者宣布做完 / 做不下去。每次只调用一次。',
  parameters: Type.Object({
    thought: Type.String({ description: '一句话：看到了什么、这一步为什么这么做' }),
    action: StringEnum(['click', 'double_click', 'move', 'scroll', 'type', 'keypress', 'drag', 'wait', 'screenshot', 'done', 'fail'] as const, {
      description: 'click/double_click/move 要 x,y；scroll 要 x,y 和 scroll_x/scroll_y；type 要 text；keypress 要 keys；drag 要 path；done 要 summary；fail 要 reason',
    }),
    x: Type.Optional(Type.Number({ description: '截图像素坐标，左上角是 (0,0)' })),
    y: Type.Optional(Type.Number()),
    button: Type.Optional(StringEnum(['left', 'right', 'middle', 'back', 'forward'] as const, { description: 'click 用哪个键，默认 left' })),
    scroll_x: Type.Optional(Type.Number({ description: '横向滚动像素，正数向右' })),
    scroll_y: Type.Optional(Type.Number({ description: '纵向滚动像素，正数向下' })),
    text: Type.Optional(Type.String({ description: 'type：往当前焦点里输入的文字' })),
    keys: Type.Optional(Type.Array(Type.String(), { description: 'keypress：一组同时按下的键，如 ["ctrl","c"]、["ENTER"]、["ARROWDOWN"]' })),
    path: Type.Optional(Type.Array(Type.Object({ x: Type.Number(), y: Type.Number() }), { description: 'drag：按下、经过、松开的坐标，至少两个点' })),
    seconds: Type.Optional(Type.Number({ description: 'wait 的秒数，默认 2，最多 10' })),
    summary: Type.Optional(Type.String({ description: 'done：做完了什么、结果是什么、值得注意的事' })),
    reason: Type.Optional(Type.String({ description: 'fail：为什么做不下去、卡在哪、需要人做什么' })),
  }),
};

const SYSTEM = `你在操作一台电脑，通过截图看屏幕，一次只做一个动作。每一步都调用 computer 工具给出这个动作，不要用文字描述动作。
坐标以本次截图的像素为准，左上角是 (0,0)。
规则：
- 先看清再点，点之前确认目标就在这张截图里。
- 往已经有内容的输入框（地址栏、搜索框、表单）里输入之前，先点它，再 keypress ["ctrl","a"] 全选，否则新内容会接在旧内容后面。
- 系统会告诉你上一步之后画面有没有变化。说「画面没有变化」时不要原样再来一次：换个位置、换个办法，或者先 wait 一下等页面加载。
- 只根据这张截图里真正看得见的东西判断，不要假设上一步已经生效。
- 需要登录、验证码、付款、不可逆的删除，用 fail 说明并停下；不要输入任何密码或密钥。
- 目标达成后立刻 done，summary 写你在最后这张截图里看到的结果（页面标题、文件名、状态），不要写你的打算。`;

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

/** The OS tools the hands need on this machine — a machine dependency like any skill's (deps.ts installs them). */
export const handsBins = (): string[] => (platform() === 'linux' ? ['xdotool', 'import', 'identify'] : platform() === 'darwin' ? ['cliclick'] : []);

/** Whether this machine can run the loop at all, and why not. */
export async function guiCapability(display?: string): Promise<{ ok: boolean; note?: string }> {
  if (platform() === 'linux' && !display) return { ok: false, note: '电脑没开' };
  if (platform() !== 'linux' && platform() !== 'darwin') return { ok: false, note: '这个系统上还不支持操作屏幕' };
  for (const bin of handsBins()) if (!(await which(bin))) return { ok: false, note: `这台机器上没有 ${bin}，装好才能替你点鼠标` };
  return { ok: true };
}

async function operateNow(hands: Hands, goal: string, opts: { display?: string; outDir: string; context?: string; maxSteps?: number }): Promise<OperateResult> {
  const driver = platform() === 'darwin' ? macDriver() : xDriver(opts.display ?? ':100');
  const maxSteps = Math.max(1, Math.min(60, opts.maxSteps ?? 25));
  const dir = join(opts.outDir, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19));
  mkdirSync(dir, { recursive: true });
  const history: string[] = [];
  const log: string[] = [`# ${goal}`, ''];
  let lastShot: string | undefined;
  let prevShot: Shot | undefined;
  let unparsed = 0;
  let stuck = 0;
  let lastAction = '';
  /** where our own last action left the pointer, so someone else moving it is visible */
  let mine: { x: number; y: number } | undefined;
  /** what the previous action did to the screen, told to the model instead of left for it to guess */
  let effect = '';
  for (let i = 1; i <= maxSteps; i++) {
    // One screen, shared with the person watching it. If they take the mouse, the model's next click would land
    // somewhere else and its typing would go to whatever window they focused — so wait for the hand to come off,
    // then look again. Waiting is not a step, and it does not count towards "the screen stopped changing".
    const waited = await yieldToHuman(driver, mine);
    if (waited) {
      log.push(`（有人在用这台电脑，等了 ${Math.round(waited / 1000)} 秒他停下来才接着做）`);
      prevShot = undefined;
      stuck = 0;
      effect = '刚才有人自己动了这台电脑，画面可能已经不是你上一步留下的样子了，先看清楚当前截图再决定下一步。';
    }
    const shot = await driver.shot(dir, `step-${String(i).padStart(2, '0')}`);
    lastShot = shot.file;
    const changed = prevShot ? await screenChanged(prevShot.file, shot.file) : undefined;
    if (changed === false) {
      effect = '上一步之后画面没有变化（点空了、控件没响应、或者这一步本来就不改变画面）。';
      stuck += 1;
    } else {
      if (changed === true) effect = '';
      stuck = 0;
    }
    if (stuck >= 3) return finish(false, `连续三步画面都没有变化，最后一个动作是 ${lastAction}`, i, lastShot, log, dir);
    const prompt = [
      `目标：${goal}`,
      opts.context ? `背景：${opts.context}` : '',
      history.length ? `已经做过（最近 ${Math.min(history.length, 8)} 步）：\n${history.slice(-8).join('\n')}` : '这是第一步。',
      effect,
      `截图尺寸 ${shot.w}×${shot.h}。第 ${i}/${maxSteps} 步。调用 computer 给出这一步的动作。`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const res = await hands.runtime.completeSimple(hands.model, {
      systemPrompt: SYSTEM,
      tools: [ACT_TOOL],
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, imageContent(shot.file, 'image/png')], timestamp: Date.now() }],
    });
    // Any tool call is the action: there is only one tool, and models rename it (`act`, `computer_call`, the
    // namespaced form) often enough that matching on the name loses real actions.
    const call = res.content.find((c): c is Extract<typeof c, { type: 'toolCall' }> => c.type === 'toolCall');
    const said = res.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
      .trim();
    // The schema-checked call is the contract; prose JSON is the fallback for a model that ignores tools.
    const parsed = call ? fromArgs(call.arguments) : parseStep(said);
    if (!parsed) {
      // Prose instead of a call is confusion, not completion: the native protocol's "a message ends the run" only
      // holds for a model actually speaking it. Retry, and if it keeps talking, end with what it said, unfinished.
      log.push(`## ${i}\n模型没有给出可执行的动作：${said.slice(0, 300) || '（空回复）'}`);
      history.push(`${i}. （没有给出动作，重试）${said ? `：${said.slice(0, 60)}` : ''}`);
      unparsed++;
      // Nothing was done, so the screen is unchanged for a reason that has nothing to do with a missed click.
      prevShot = undefined;
      if (unparsed >= 3) return finish(false, said ? `模型只是在描述，没有真的操作：${said.slice(0, 300)}` : '模型连续三次没有给出可执行的动作', i, lastShot, log, dir);
      continue;
    }
    unparsed = 0;
    const { thought, action } = parsed;
    const desc = describe(action);
    log.push(`## ${i}${changed === false ? '（上一步画面没变）' : ''}\n${thought}\n→ ${desc}`);
    history.push(`${i}. ${desc}${changed === false ? ' [上一步画面没变]' : ''}${thought ? `（${thought.slice(0, 80)}）` : ''}`);
    if (action.type === 'done') return finish(true, action.summary, i, lastShot, log, dir);
    if (action.type === 'fail') return finish(false, action.reason, i, lastShot, log, dir);
    lastAction = desc;
    prevShot = shot;
    try {
      await perform(driver, action, shot.scale);
      mine = await driver.pointer();
    } catch (e) {
      log.push(`（执行失败：${(e as Error).message}）`);
      history.push(`   执行失败：${(e as Error).message.slice(0, 120)}`);
      effect = `上一步执行失败：${(e as Error).message.slice(0, 120)}`;
      prevShot = undefined;
    }
    await new Promise((r) => setTimeout(r, action.type === 'wait' ? Math.min(10, action.seconds ?? 2) * 1000 : STEP_PAUSE_MS));
  }
  const shot = await driver.shot(dir, 'step-end').catch(() => undefined);
  return finish(false, `${maxSteps} 步内没有做完`, maxSteps, shot?.file ?? lastShot, log, dir);
}

/**
 * Wait while a person is using the screen. `mine` is where our own last action left the pointer: anything else
 * means a hand is on it. Returns how long we waited (0 when nobody was there), so the caller can tell the model
 * that the screen may have moved under it.
 */
async function yieldToHuman(d: Driver, mine: { x: number; y: number } | undefined): Promise<number> {
  if (!mine) return 0;
  const start = Date.now();
  let at = await d.pointer();
  if (!at || (at.x === mine.x && at.y === mine.y)) return 0;
  let stillSince = Date.now();
  while (Date.now() - start < HUMAN_WAIT_MAX_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = await d.pointer();
    if (!now) break;
    if (now.x !== at?.x || now.y !== at?.y) stillSince = Date.now();
    at = now;
    if (Date.now() - stillSince >= HUMAN_STILL_MS) break;
  }
  return Date.now() - start;
}

/**
 * Did the screen change between two screenshots? A click that missed leaves the picture identical, and a model
 * looking at one picture cannot tell that from a click that worked. ImageMagick counts the differing pixels; where
 * it is not installed, identical bytes still prove nothing changed. Undefined means "cannot tell", which the caller
 * reads as changed, so an uncertain check never accuses the model of being stuck.
 */
let magick: boolean | undefined;
async function screenChanged(before: string, after: string): Promise<boolean | undefined> {
  magick ??= (await which('compare')) && (await which('identify'));
  if (magick) {
    try {
      // `compare` exits non-zero when the images differ, so the shell keeps going and the count is on stderr.
      const out = await exec('/bin/sh', ['-lc', `compare -metric AE -fuzz 3% ${JSON.stringify(before)} ${JSON.stringify(after)} null: 2>&1 || true`], undefined, 20_000);
      const n = Number(out.trim().split(/\s+/)[0].replace(/[^\d.e+]/gi, ''));
      const { w, h } = await size(after);
      if (Number.isFinite(n) && w && h) return n > w * h * CHANGED_RATIO;
    } catch {
      /* fall through to the byte check */
    }
  }
  try {
    const [a, b] = [readFileSync(before), readFileSync(after)];
    if (a.equals(b)) return false;
    return Math.abs(a.length - b.length) > Math.max(a.length, b.length) * 0.005 ? true : undefined;
  } catch {
    return undefined;
  }
}

async function size(file: string): Promise<{ w: number; h: number }> {
  try {
    const [w, h] = (await exec('identify', ['-format', '%w %h', file])).trim().split(' ').map(Number);
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

/** The tool call's arguments as an action, with the same checks the free-text path does. */
function fromArgs(a: Record<string, unknown>): { thought: string; action: Step } | undefined {
  return parseAction(String(a.action ?? a.type ?? ''), a, String(a.thought ?? ''));
}

function finish(ok: boolean, summary: string, steps: number, lastShot: string | undefined, log: string[], dir: string): OperateResult {
  log.push('', ok ? `✔ ${summary}` : `✘ ${summary}`);
  const file = join(dir, 'log.md');
  writeFileSync(file, log.join('\n') + '\n');
  return { ok, summary, steps, lastShot: lastShot && existsSync(lastShot) ? lastShot : undefined, log: file };
}

/**
 * Free-text fallback, for a model that describes the action instead of calling the tool: a JSON object somewhere in
 * the reply, or, failing that, `action: click / x: 184 / y: 439` written as lines. A weak model does this on a third
 * of its turns, and every one of those turns is otherwise a wasted screenshot.
 */
function parseStep(raw: string): { thought: string; action: Step } | undefined {
  const s = raw.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) return parseLoose(s);
  try {
    const o = JSON.parse(s.slice(a, b + 1)) as { thought?: string; action?: unknown };
    // Either {thought, action:{type,…}} or the flat shape of the tool call.
    const act = (o.action && typeof o.action === 'object' ? (o.action as Record<string, unknown>) : (o as unknown as Record<string, unknown>)) ?? {};
    const type = String((act.type as string) ?? (typeof o.action === 'string' ? o.action : '') ?? '');
    return parseAction(type, act, String(o.thought ?? ''));
  } catch {
    return parseLoose(s);
  }
}

/** `action: click`, `x: 184`, `keys: ["ctrl","a"]` as loose lines rather than JSON. */
function parseLoose(s: string): { thought: string; action: Step } | undefined {
  const field = (k: string) => new RegExp(`(?:^|[\\n,{])\\s*"?${k}"?\\s*[:=]\\s*("[^"]*"|\\[[^\\]]*\\]|[^\\n,}]+)`, 'i').exec(s)?.[1]?.trim();
  const unquote = (v: string | undefined) => (v ? v.replace(/^"|"$/g, '').trim() : undefined);
  const type = unquote(field('action') ?? field('type'))?.toLowerCase();
  if (!type) return undefined;
  const num = (k: string) => {
    const v = Number(unquote(field(k)));
    return Number.isFinite(v) ? v : undefined;
  };
  const keysRaw = field('keys');
  const f: Record<string, unknown> = {
    x: num('x'), y: num('y'), x2: num('x2'), y2: num('y2'), amount: num('amount'), seconds: num('seconds'),
    scroll_x: num('scroll_x'), scroll_y: num('scroll_y'),
    text: unquote(field('text')), button: unquote(field('button')), direction: unquote(field('direction')),
    summary: unquote(field('summary')), reason: unquote(field('reason')),
    keys: keysRaw?.startsWith('[') ? keysRaw.slice(1, -1).split(',').map((k) => k.replace(/['"]/g, '').trim()).filter(Boolean) : unquote(keysRaw),
  };
  return parseAction(type.replace(/[^a-z_]/g, ''), f, unquote(field('thought')) ?? '');
}

/**
 * One action out of loose fields, whichever path they came in by. Native names are what the schema asks for; the
 * shapes a model falls back to on its own (`right_click`, `key`, `direction`/`amount`, `x2`/`y2`) are accepted and
 * translated, because a wrongly shaped action is still a real intention.
 */
function parseAction(type: string, f: Record<string, unknown>, thought: string): { thought: string; action: Step } | undefined {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v));
  const step = (action: Step) => ({ thought, action });
  const xy = () => ({ x: n(f.x), y: n(f.y) });
  switch (type) {
    case 'click':
    case 'left_click':
    case 'right_click':
    case 'middle_click': {
      const { x, y } = xy();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      const named = type === 'right_click' ? 'right' : type === 'middle_click' ? 'middle' : undefined;
      const asked = String(f.button ?? '').toLowerCase();
      const button = (named ?? (['left', 'right', 'middle', 'back', 'forward', 'wheel'].includes(asked) ? asked : 'left')) as MouseButton;
      return step({ type: 'click', button, x, y });
    }
    case 'double_click':
    case 'doubleclick': {
      const { x, y } = xy();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      return step({ type: 'double_click', x, y });
    }
    case 'move':
    case 'mouse_move': {
      const { x, y } = xy();
      if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
      return step({ type: 'move', x, y });
    }
    case 'type':
      return step({ type: 'type', text: String(f.text ?? '') });
    case 'keypress':
    case 'key': {
      const raw = f.keys ?? f.key ?? f.text;
      const keys = (Array.isArray(raw) ? raw.map((k) => String(k)) : String(raw ?? '').split('+')).map((k) => k.trim()).filter(Boolean);
      return keys.length ? step({ type: 'keypress', keys }) : undefined;
    }
    case 'scroll': {
      const { x, y } = xy();
      const dir = String(f.direction ?? '').toLowerCase();
      // `direction` + `amount` is what a model writes when it has not read the schema; one notch is a wheel click.
      const notches = (n(f.amount) || 3) * WHEEL_PX;
      const sx = Number.isFinite(n(f.scroll_x)) ? n(f.scroll_x) : dir === 'right' ? notches : dir === 'left' ? -notches : 0;
      const sy = Number.isFinite(n(f.scroll_y)) ? n(f.scroll_y) : dir === 'down' ? notches : dir === 'up' ? -notches : dir ? 0 : notches;
      if (!sx && !sy) return undefined;
      return step({ type: 'scroll', x: Number.isFinite(x) ? x : 640, y: Number.isFinite(y) ? y : 400, scroll_x: sx, scroll_y: sy });
    }
    case 'drag': {
      const raw = Array.isArray(f.path) ? (f.path as { x?: unknown; y?: unknown }[]) : undefined;
      const path = (raw ? raw.map((p) => ({ x: n(p.x), y: n(p.y) })) : [{ x: n(f.x), y: n(f.y) }, { x: n(f.x2), y: n(f.y2) }]).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
      return path.length >= 2 ? step({ type: 'drag', path }) : undefined;
    }
    case 'wait':
      return step({ type: 'wait', seconds: n(f.seconds) || 2 });
    case 'screenshot':
      return step({ type: 'screenshot' });
    case 'done':
      return step({ type: 'done', summary: String(f.summary ?? thought ?? '完成') });
    case 'fail':
      return step({ type: 'fail', reason: String(f.reason ?? thought ?? '做不下去') });
    default:
      return undefined;
  }
}

function describe(a: Step): string {
  switch (a.type) {
    case 'click':
      return `click${a.button === 'left' ? '' : `:${a.button}`} (${Math.round(a.x)},${Math.round(a.y)})`;
    case 'double_click':
      return `double_click (${Math.round(a.x)},${Math.round(a.y)})`;
    case 'move':
      return `move (${Math.round(a.x)},${Math.round(a.y)})`;
    case 'type':
      return `type "${a.text.length > 40 ? a.text.slice(0, 40) + '…' : a.text}"`;
    case 'keypress':
      return `keypress ${a.keys.join('+')}`;
    case 'scroll':
      return `scroll ${a.scroll_x ? `x${a.scroll_x} ` : ''}${a.scroll_y ? `y${a.scroll_y} ` : ''}@(${Math.round(a.x)},${Math.round(a.y)})`;
    case 'drag':
      return `drag ${a.path.map((p) => `(${Math.round(p.x)},${Math.round(p.y)})`).join('→')}`;
    case 'wait':
      return `wait ${a.seconds ?? 2}s`;
    case 'screenshot':
      return 'screenshot';
    case 'done':
      return `done: ${a.summary}`;
    case 'fail':
      return `fail: ${a.reason}`;
  }
}

async function perform(d: Driver, a: Step, scale: number) {
  const s = (v: number) => v * scale;
  switch (a.type) {
    case 'click':
      return d.click(s(a.x), s(a.y), a.button);
    case 'double_click':
      return d.doubleClick(s(a.x), s(a.y));
    case 'move':
      return d.move(s(a.x), s(a.y));
    case 'type':
      return a.text ? d.type(a.text) : undefined;
    case 'keypress':
      return d.keypress(a.keys);
    case 'scroll':
      return d.scroll(s(a.x), s(a.y), a.scroll_x, a.scroll_y);
    case 'drag':
      return d.drag(a.path.map((p) => ({ x: s(p.x), y: s(p.y) })));
    default:
      // wait and screenshot are the loop's business: the next turn takes a fresh picture anyway.
      return undefined;
  }
}
