import { recordImages } from './meter.ts';
/**
 * Drawing. A bot makes pictures the same way it reads them: one call to a model that can do it, saved as a file in
 * its workspace. Without this, a deck, a report or a game has no imagery at all — the bot falls back to coloured
 * boxes and emoji, which is what "no taste" actually looks like.
 *
 * One key for everything: OpenRouter serves Gemini, FLUX, Recraft and OpenAI's image models, so switching style
 * or tier is switching a model id, not adding a credential. It does take two different doors to reach them —
 * see `once` — but that is this file's problem, not the bot's.
 */
import type { ImageContent, ImagesInputContent, Usage } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import { config } from './config.ts';

const images = builtinImagesModels();

/** How good a picture has to be. Two axes, because "what kind of picture" and "how good" are different questions. */
export type DrawTier = '快' | '标准' | '精';
export const DRAW_TIERS: DrawTier[] = ['快', '标准', '精'];
export const DEFAULT_TIER: DrawTier = '标准';

/**
 * style（画什么）× tier（要多好）→ 哪个模型。
 *
 * Measured 2026-09-11, one picture each through this very path, real billed cost and wall clock:
 *
 *   插画  快 gemini-3.1-flash-lite  4.4s $0.034 │ 标准 gpt-image-2.5-flare 13.8s $0.0071 │ 精 gpt-image-2.5-sunburst 15.6s $0.0071
 *   照片  快 flux.2-klein-4b        3.3s $0.014 │ 标准 flux.2-pro           8-15s $0.030  │ 精 flux.2-max             21.4s $0.070
 *   矢量  快/标准 recraft-v4.1-vector 9-13s $0.080                                        │ 精 recraft-v4.1-pro-vector 16.4s $0.300
 *
 * Three things measurement said and intuition did not. The GPT Image 2.5 pair is at once the best-looking and by
 * far the cheapest illustration model — a tenth of the old default (gemini-3.1-flash-image, $0.067) and a
 * twentieth of gemini-3-pro-image ($0.135), which for the same prompt drew something visibly worse. The "fast"
 * illustration tier is not the cheap one: 3× the speed at 4.7× the price, so it is for a picture someone is
 * waiting on, never for saving money — which is why avatars draw at 标准, not 快. And gpt-image-1-mini, despite
 * the name, took 41s and cost $0.05; it is not in the table.
 */
export const DRAW_STYLES: Record<string, { label: string; hint: string; models: Record<DrawTier, string> }> = {
  插画: {
    label: '插画 / 图示',
    hint: '默认。配图、示意图、角色、海报底图',
    models: {
      快: 'openrouter/google/gemini-3.1-flash-lite-image',
      标准: 'openrouter/openai/gpt-image-2.5-flare',
      精: 'openrouter/openai/gpt-image-2.5-sunburst',
    },
  },
  照片: {
    label: '照片级',
    hint: '要看起来像拍出来的：产品图、场景照、人物照',
    models: {
      快: 'openrouter/black-forest-labs/flux.2-klein-4b',
      标准: 'openrouter/black-forest-labs/flux.2-pro',
      精: 'openrouter/black-forest-labs/flux.2-max',
    },
  },
  矢量: {
    label: '矢量 / 图标',
    hint: '图标、logo、扁平插画；出的是 SVG，放大不糊',
    models: {
      快: 'openrouter/recraft/recraft-v4.1-vector',
      标准: 'openrouter/recraft/recraft-v4.1-vector',
      精: 'openrouter/recraft/recraft-v4.1-pro-vector',
    },
  },
};

/** 每档大致多快、多少钱，写进工具描述里让 bot 自己权衡（实测值，见上表）。 */
export const TIER_HINT: Record<DrawTier, string> = {
  快: '约 5 秒，质量一般，而且不便宜——只在用户干等着、这张图好不好无所谓时用',
  标准: '约 12 秒，最省钱，默认就用它',
  精: '约 13 秒，和标准同价但模型更强——封面、主视觉、细节多或用户会盯着看的图用它',
};

export const modelIdFor = (style?: string, tier?: DrawTier) =>
  DRAW_STYLES[style ?? '插画']?.models[tier ?? DEFAULT_TIER] ?? DRAW_STYLES.插画.models[tier ?? DEFAULT_TIER] ?? config.imageModel;

/**
 * The model record for an id, even one this pi build has never heard of. OpenRouter ships image models faster
 * than the SDK's catalog is regenerated — GPT Image 2.5 serves fine over the wire while `getModel` returns
 * nothing for it — and a table entry that does not resolve is not a missing style, it is `canDraw()` going false
 * and the whole tool disappearing. So an unknown id borrows the shape of a known sibling on the same provider
 * (same api, baseUrl and auth; only the id differs) rather than being dropped.
 */
const synthesized = new Map<string, ReturnType<typeof images.getModel>>();
export function model(style?: string, tier?: DrawTier) {
  const id = modelIdFor(style, tier);
  const [provider] = id.split('/');
  const name = id.slice(provider.length + 1);
  try {
    const known = images.getModel(provider, name);
    if (known) return known;
    const cached = synthesized.get(id);
    if (cached) return cached;
    const sibling = images.getModels(provider)?.[0];
    if (!sibling) return undefined;
    const made = { ...sibling, id: name, name: id };
    synthesized.set(id, made);
    return made;
  } catch {
    return undefined;
  }
}

/** Whether this installation can draw at all (no image model resolvable = the tool is not offered). */
export const canDraw = () => !!model();

export interface Drawn {
  data: string;
  mimeType: string;
}

/**
 * How many pictures this machine draws at the same time. A bot that needs a set — seven slides, a sprite sheet —
 * fires one `draw` per picture in a single turn and the harness runs them concurrently, so the ceiling has to live
 * here rather than in the model's head: every bot on the machine shares one image key, and two bots each asking
 * for eight must not become sixteen simultaneous requests on that account. Over the line calls queue, they never
 * fail; a set of eight is two waves, not eight round trips.
 */
const AT_ONCE = 6;
/** What the tool tells the model it may fan out to in one turn, comfortably inside what the gate absorbs. */
export const DRAW_AT_ONCE = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];
async function gate<T>(run: () => Promise<T>): Promise<T> {
  // `while`, not `if`: a waiter woken by a release re-checks, because a fresh call can take the freed slot
  // synchronously before the waiter's continuation runs.
  while (inFlight >= AT_ONCE) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await run();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** Worth asking again: the account was busy, not the prompt bad. A rejected prompt does not improve on retry. */
const TRANSIENT = /429|rate.?limit|too many|timeout|timed out|\b50[234]\b|overload|capacity|ECONNRESET|ETIMEDOUT|fetch failed|socket hang up/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One picture from a prompt, optionally with reference images (the same call edits a picture or follows a style,
 * which is how "keep the same character across slides" works — only the models that take image input).
 */
export async function drawImage(prompt: string, refs: ImageContent[] = [], style?: string, tier?: DrawTier, who?: string): Promise<Drawn[]> {
  const m = model(style, tier);
  if (!m) throw new Error('这套 bot 没有配画图模型（imageModel），画不了。');
  if (refs.length && !m.input?.includes('image')) throw new Error(`「${style ?? '插画'}·${tier ?? DEFAULT_TIER}」这个模型不吃参考图，去掉 refs 或换一档。`);
  const input: ImagesInputContent[] = [{ type: 'text', text: prompt }, ...refs];
  // A whole set drawn at once means a rate limit hits several pictures of the same deck together; one of them
  // coming back "画图失败" while its six siblings succeeded is worse than waiting a second and asking again.
  let last: Error | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(700 * 2 ** attempt + Math.random() * 400);
    try {
      const drawn = await gate(() => once(m, input));
      // Whichever of the two doors it came through: pi's path reports what the provider charged, the direct one
      // does not, and then the count is priced from the table.
      recordImages('draw', who, `${m.provider}/${m.id}`, drawn.length, lastUsage);
      return drawn;
    } catch (e) {
      last = e as Error;
      if (!TRANSIENT.test(last.message)) throw last;
    }
  }
  throw last ?? new Error('画图失败');
}

/**
 * OpenRouter has two doors for pictures and pi only knows one. Its `openrouter-images` api posts to
 * chat/completions with `modalities`, which is how the Gemini, FLUX and Recraft models work; OpenAI's image
 * models are served only at /api/v1/images/generations and answer the other door with a 404 that says so. Rather
 * than keep a list of which is which — it would be stale the week OpenRouter ships the next one — the first call
 * for an id tries pi's path and reads that 404 as "use the other door", then remembers.
 */
const CHAT_DOOR_CLOSED = /cannot be used with the chat\/completions endpoint|use the \/api\/v1\/images endpoint/i;
const directOnly = new Set<string>();

async function once(m: NonNullable<ReturnType<typeof model>>, input: ImagesInputContent[]): Promise<Drawn[]> {
  const id = `${m.provider}/${m.id}`;
  if (directOnly.has(id)) return viaImagesApi(m, input);
  try {
    return await viaPi(m, input);
  } catch (e) {
    if (!CHAT_DOOR_CLOSED.test((e as Error).message)) throw e;
    directOnly.add(id);
    return viaImagesApi(m, input);
  }
}

/** OpenRouter's dedicated image endpoint, for the models pi's chat-shaped path cannot reach. */
async function viaImagesApi(m: NonNullable<ReturnType<typeof model>>, input: ImagesInputContent[]): Promise<Drawn[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('没有 OPENROUTER_API_KEY，画不了。');
  const prompt = input
    .filter((b): b is Extract<ImagesInputContent, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
  const refs = input.filter((b): b is ImageContent => b.type === 'image').map((b) => `data:${b.mimeType};base64,${b.data}`);
  const r = await fetch(`${m.baseUrl ?? 'https://openrouter.ai/api/v1'}/images/generations`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: m.id, prompt, n: 1, ...(refs.length ? { image: refs } : {}) }),
  });
  const j = (await r.json()) as { data?: { b64_json?: string; url?: string }[]; error?: { message?: string } };
  if (!r.ok || j.error) throw new Error(`${r.status}: ${j.error?.message ?? JSON.stringify(j).slice(0, 200)}`);
  const out: Drawn[] = [];
  for (const d of j.data ?? []) {
    if (d.b64_json) out.push({ data: d.b64_json, mimeType: 'image/png' });
    else if (d.url) {
      const b = await fetch(d.url).then((x) => x.arrayBuffer());
      out.push({ data: Buffer.from(b).toString('base64'), mimeType: 'image/png' });
    }
  }
  if (!out.length) throw new Error('模型没有出图');
  return out;
}

/** What the last picture actually cost, when the provider said so (viaPi only). */
let lastUsage: Usage | undefined;

async function viaPi(m: NonNullable<ReturnType<typeof model>>, input: ImagesInputContent[]): Promise<Drawn[]> {
  lastUsage = undefined;
  const result = await images.generateImages(m, { input });
  lastUsage = result.usage;
  if (result.stopReason === 'error') throw new Error(result.errorMessage ?? '画图失败');
  const out = result.output.filter((b): b is ImageContent => b.type === 'image');
  if (!out.length) {
    const said = result.output
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    throw new Error(said ? `模型没有出图：${said.slice(0, 200)}` : '模型没有出图');
  }
  return out.map((b) => ({ data: b.data, mimeType: b.mimeType }));
}

/** The vector models answer with SVG; saving that as .png would give the bot a file nothing can open. */
export const extFor = (mime: string) =>
  mime.includes('svg') ? 'svg' : mime.includes('jpeg') || mime.includes('jpg') ? 'jpg' : mime.includes('webp') ? 'webp' : 'png';
