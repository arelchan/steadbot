import type { Api, Model } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_RERANK_MODEL, ambientKey, config, readFileConfig, updateConfigFile, type ModelInfo } from './config.ts';
import { DRAW_STYLES } from './draw.ts';
import { DEFAULT_VISION_MODEL } from './vision.ts';

/**
 * 设置 › 模型.
 *
 * The page is a list of jobs, not a list of vendors: one row per thing a model does here, each row picking its own
 * provider and model id. pi already knows forty providers, what each one needs to authenticate, and every model's
 * price and context window, so none of that is a list we keep — this file only translates it into the shape the App
 * draws, and writes back what the user chose.
 *
 * Four of the rows are pinned to OpenRouter and say so on the page: pi's image api is `openrouter-images` and every
 * image model in its catalog is OpenRouter's, web search is OpenRouter's own `web` plugin, and embeddings and
 * reranking are not something pi does at all — those two calls are ours, straight to the same endpoint.
 */

export type SlotId = 'model' | 'lightModel' | 'visionModel' | 'guiModel' | 'imageModel' | 'searchModel' | 'embeddingModel' | 'rerankModel';

export interface SlotDef {
  id: SlotId;
  /** what the model has to be able to do, which is also what the model list is filtered by */
  needs: 'chat' | 'vision' | 'image' | 'embed' | 'rerank';
  /** the providers that can serve this row at all; absent means any of them */
  only?: string[];
  /** left empty, this row runs on another row's model */
  inherits?: SlotId;
  /** left empty, this row falls back to a model the product ships with */
  fallback?: string;
  /** left empty, the product picks per call (drawing chooses by style and tier) */
  auto?: boolean;
  /** the row can be switched off entirely */
  offable?: boolean;
}

export const SLOTS: SlotDef[] = [
  { id: 'model', needs: 'chat' },
  { id: 'lightModel', needs: 'chat', inherits: 'model' },
  { id: 'visionModel', needs: 'vision', fallback: DEFAULT_VISION_MODEL },
  { id: 'guiModel', needs: 'vision', inherits: 'visionModel' },
  { id: 'imageModel', needs: 'image', only: ['openrouter', 'openai', 'xai', 'together', 'siliconflow', 'zhipu'], auto: true },
  { id: 'searchModel', needs: 'chat', only: ['openrouter', 'perplexity'], inherits: 'lightModel' },
  { id: 'embeddingModel', needs: 'embed', only: ['openrouter', 'openai', 'siliconflow', 'jina', 'voyage', 'dashscope', 'zhipu', 'mistral'], fallback: DEFAULT_EMBEDDING_MODEL },
  { id: 'rerankModel', needs: 'rerank', only: ['openrouter', 'jina', 'voyage', 'siliconflow', 'cohere'], fallback: DEFAULT_RERANK_MODEL, offable: true },
];

/**
 * The vendors pi does not carry, for the four rows this server calls itself.
 *
 * pi's forty providers are chat providers: it has no concept of an embedding, a reranker or a search plugin, and
 * its image api is OpenRouter's alone. But those four calls are ours — plain HTTP to an OpenAI-shaped endpoint —
 * so any vendor that speaks the same shape can serve them, whether or not pi has heard of it. What each one is
 * good for is what `SLOTS[].only` says above; all any of them needs from us is a base URL and a key.
 */
export const EXTRA_PROVIDERS: Record<string, { name: string; baseUrl: string; apiKey: string }> = {
  siliconflow: { name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'SiliconFlow API key' },
  jina: { name: 'Jina AI', baseUrl: 'https://api.jina.ai/v1', apiKey: 'Jina API key' },
  voyage: { name: 'Voyage AI', baseUrl: 'https://api.voyageai.com/v1', apiKey: 'Voyage API key' },
  cohere: { name: 'Cohere', baseUrl: 'https://api.cohere.com/v1', apiKey: 'Cohere API key' },
  dashscope: { name: '阿里云百炼 DashScope', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'DashScope API key' },
  zhipu: { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '智谱 API key' },
  perplexity: { name: 'Perplexity', baseUrl: 'https://api.perplexity.ai', apiKey: 'Perplexity API key' },
};

/** Where one of our own calls goes, whether pi knows the vendor or we do. */
export const baseUrlOf = (provider: string): string | undefined =>
  (runtime?.getProvider(provider)?.baseUrl ?? EXTRA_PROVIDERS[provider]?.baseUrl)?.replace(/\/$/, '');

export interface ProviderRow {
  id: string;
  name: string;
  /** false when this provider cannot be picked for anything (no models pi can talk to) */
  chat: boolean;
  /** what this provider calls its key ("OpenRouter API key"), for the field's label */
  apiKey?: string;
  /** the provider offers a sign-in instead of a key; `subscription` means an existing plan counts */
  oauth?: { label: string; subscription: boolean };
  /** true when at least one row already has a key for it — the App sorts these to the top */
  keyed?: boolean;
}

export interface ModelRow {
  id: string;
  name: string;
  vision: boolean;
  context?: number;
  /** dollars per million tokens, as pi's catalog has it */
  costIn?: number;
  costOut?: number;
}

export interface SlotRow extends SlotDef {
  /** what the user chose, empty when the row is on its default */
  value?: string;
  /** what actually runs this turn, after inheritance and fallbacks */
  effective?: string;
  /** true when `effective` has no key behind it */
  blocked?: boolean;
  /** this row's own key, as ••••, when it has one */
  key?: string;
  /** where the key it actually uses comes from */
  keyFrom?: KeySource;
  /** set from the environment by whoever deployed this: shown, not editable */
  pinned?: boolean;
  meta?: ModelInfo;
}

export interface ModelsPage {
  slots: SlotRow[];
  providers: ProviderRow[];
  /**
   * What each row may choose from. Chat and vision rows read a provider's own catalog and are keyed by provider id;
   * drawing, embedding and reranking are keyed `<needs>:<provider>`, and a missing key means "type the id".
   */
  models: Record<string, ModelRow[]>;
}

/** The four rows pinned to OpenRouter draw from these lists instead of a chat catalog. */
const imagesCatalog = builtinImagesModels();

/**
 * Embedding and rerank models are in nobody's catalog — pi does not model them and providers do not publish them
 * the way they publish chat models. These are the ones this product has actually run on, per provider; any other
 * provider's row is a text field, which is the honest answer rather than a short list pretending to be complete.
 */
const row = (id: string, name?: string): ModelRow => ({ id, name: name ?? id, vision: false });

const EMBED_MODELS: Record<string, ModelRow[]> = {
  openrouter: [row('baai/bge-m3', 'BGE-M3'), row('qwen/qwen3-embedding-8b', 'Qwen3 Embedding 8B')],
  openai: [row('text-embedding-3-large'), row('text-embedding-3-small')],
  siliconflow: [row('BAAI/bge-m3', 'BGE-M3'), row('Qwen/Qwen3-Embedding-8B', 'Qwen3 Embedding 8B'), row('Qwen/Qwen3-Embedding-4B', 'Qwen3 Embedding 4B')],
  jina: [row('jina-embeddings-v4'), row('jina-embeddings-v3')],
  voyage: [row('voyage-3.5'), row('voyage-3.5-lite'), row('voyage-3-large')],
  dashscope: [row('text-embedding-v4'), row('text-embedding-v3')],
  zhipu: [row('embedding-3')],
  mistral: [row('mistral-embed')],
};
const RERANK_MODELS: Record<string, ModelRow[]> = {
  openrouter: [row('cohere/rerank-v3.5', 'Cohere Rerank 3.5'), row('qwen/qwen3-reranker-8b', 'Qwen3 Reranker 8B')],
  jina: [row('jina-reranker-m0'), row('jina-reranker-v2-base-multilingual')],
  voyage: [row('rerank-2.5'), row('rerank-2.5-lite')],
  siliconflow: [row('BAAI/bge-reranker-v2-m3', 'BGE Reranker v2-m3'), row('Qwen/Qwen3-Reranker-8B', 'Qwen3 Reranker 8B')],
  cohere: [row('rerank-v3.5'), row('rerank-multilingual-v3.0')],
};
/** Drawing at vendors other than OpenRouter: whoever answers OpenAI's `/images/generations`. */
const IMAGE_MODELS: Record<string, ModelRow[]> = {
  openai: [row('gpt-image-1'), row('gpt-image-1-mini')],
  xai: [row('grok-2-image-1212', 'Grok 2 Image')],
  together: [row('black-forest-labs/FLUX.1.1-pro', 'FLUX 1.1 Pro'), row('black-forest-labs/FLUX.1-schnell', 'FLUX.1 schnell')],
  siliconflow: [row('Qwen/Qwen-Image', 'Qwen Image'), row('Kwai-Kolors/Kolors', 'Kolors')],
  zhipu: [row('cogview-4', 'CogView-4')],
};
/** The search row at a vendor whose models search by themselves, with no plugin to switch on. */
const SEARCH_MODELS: Record<string, ModelRow[]> = {
  perplexity: [row('sonar'), row('sonar-pro'), row('sonar-reasoning')],
};

function imageModels(): ModelRow[] {
  const rows = new Map<string, ModelRow>();
  for (const m of imagesCatalog.getModels('openrouter') ?? []) rows.set(m.id, { id: m.id, name: m.name || m.id, vision: (m.input ?? []).includes('image') });
  // Whatever the drawing table names is drawable whether or not the static catalog has caught up with it.
  for (const st of Object.values(DRAW_STYLES))
    for (const spec of Object.values(st.models)) {
      const id = spec.replace(/^openrouter\//, '');
      if (!rows.has(id)) rows.set(id, { id, name: id, vision: true });
    }
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

let runtime: ModelRuntime | undefined;
let announce: ((rt: ModelRuntime) => void) | undefined;
/**
 * The runtime is created inside bots.init, and the memory engine starts before that — it needs to know where its
 * four legs go, so it waits on this rather than reading an empty provider list and deciding it has no key.
 */
export const runtimeReady: Promise<ModelRuntime> = new Promise((resolve) => (announce = resolve));

/** bots.ts hands the runtime over once it exists; endpointOf and modelsPage read it from here. */
export const useRuntime = (rt: ModelRuntime) => {
  runtime = rt;
  announce?.(rt);
};

/**
 * Whose key a row uses.
 *
 * One row, one key, and no reaching sideways: a row runs on the key typed into it. The one exception is not
 * another row but the machine — a deployment that put a key in the environment is paying for every row that has
 * not been given one, which is how the hosted box runs and how an open-source checkout with `OPENROUTER_API_KEY`
 * set starts working without touching the page.
 */
export type KeySource = { kind: 'own' } | { kind: 'ambient' };

/**
 * Which provider a row goes to, even before it has a model of its own — 画图 left on automatic still spends at
 * the first vendor its row can use, which is the one the shipped drawing table is written for.
 */
export function providerOfSlot(slot: SlotId): string | undefined {
  const def = SLOTS.find((s) => s.id === slot);
  return splitSpec(effectiveOf(slot))?.provider ?? def?.only?.[0];
}

export function keyOf(slot: SlotId): { key: string; source: KeySource } | undefined {
  const own = config.slotKeys[slot]?.trim();
  if (own) return { key: own, source: { kind: 'own' } };
  const provider = providerOfSlot(slot);
  const ambient = provider ? ambientKey(provider) : undefined;
  return ambient ? { key: ambient, source: { kind: 'ambient' } } : undefined;
}

/**
 * Where to send one of our own HTTP calls — web search, embeddings, reranking, drawing's direct door — which pi
 * either has no concept of or cannot reach. The base URL comes from pi when it knows the vendor and from
 * `EXTRA_PROVIDERS` when it does not; the key comes from the row.
 */
export function endpointOf(slot: SlotId): { provider: string; model: string; baseUrl: string; key: string } | undefined {
  const spec = effectiveOf(slot);
  const s = splitSpec(spec);
  if (!s || spec === 'off') return undefined;
  const baseUrl = baseUrlOf(s.provider);
  const got = keyOf(slot);
  return baseUrl && got ? { provider: s.provider, model: s.id, baseUrl, key: got.key } : undefined;
}

const sees = (m: Model<Api>) => (m.input ?? []).includes('image');

function modelRow(m: Model<Api>): ModelRow {
  return { id: m.id, name: m.name || m.id, vision: sees(m), context: m.contextWindow, costIn: m.cost?.input, costOut: m.cost?.output };
}

/** Split "provider/model-id" the way the rest of the server does: the first slash, and only the first. */
export function splitSpec(spec?: string): { provider: string; id: string } | undefined {
  if (!spec) return undefined;
  const i = spec.indexOf('/');
  return i > 0 ? { provider: spec.slice(0, i), id: spec.slice(i + 1) } : undefined;
}

/** A deployment can still pin a slot from the environment; the page shows that as chosen-and-not-editable. */
const SLOT_ENV: Record<SlotId, string> = {
  model: 'CREW_MODEL',
  lightModel: 'CREW_LIGHT_MODEL',
  visionModel: 'CREW_VISION_MODEL',
  guiModel: 'CREW_GUI_MODEL',
  imageModel: 'CREW_IMAGE_MODEL',
  searchModel: 'CREW_SEARCH_MODEL',
  embeddingModel: 'CREW_EMBEDDING_MODEL',
  rerankModel: 'CREW_RERANK_MODEL',
};

/**
 * What the user actually chose, which is not the same as what `config.<slot>` answers — those getters already
 * fold in the product's defaults, and a default shown as a choice is a choice nobody made.
 */
const slotValue = (id: SlotId): string | undefined => process.env[SLOT_ENV[id]] ?? (readFileConfig() as Record<string, string | undefined>)[id];

/** Pinned from the environment: the page shows the value but will not let it be edited here. */
export const slotPinned = (id: SlotId): boolean => !!process.env[SLOT_ENV[id]];

/**
 * Follow inheritance and defaults to the model that will actually run.
 *
 * A row that can only be served by certain vendors does not accept an answer from another one: 联网搜索 borrows
 * 轻模型's model, but if 轻模型 has been moved to a vendor that cannot search, borrowing it would mean answering
 * from the model's memory and calling it a search. Better to have no model and say so.
 */
export function effectiveOf(id: SlotId, seen = new Set<SlotId>()): string | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  const def = SLOTS.find((s) => s.id === id)!;
  const spec = slotValue(id)?.trim() || (def.inherits ? effectiveOf(def.inherits, seen) : def.fallback);
  if (!spec || spec === 'off') return spec || undefined;
  const p = splitSpec(spec)?.provider;
  return def.only && (!p || !def.only.includes(p)) ? undefined : spec;
}

/**
 * Whether a row moved to this provider would already have something to pay with — the environment, or a key pi
 * has stored. Deliberately not counting another row's key: that key is that row's, so a row that would need one
 * of its own is asked for one the moment the provider is picked.
 */
function anyKeyFor(rt: ModelRuntime | undefined, id: string): boolean {
  return !!ambientKey(id) || (!!rt?.getProvider(id) && rt.getProviderAuthStatus(id).configured);
}

/**
 * Everything 设置 › 模型 draws — except the model catalogs it cannot show yet.
 *
 * Forty providers hold about eighteen hundred models between them, a fifth of a megabyte of JSON that the page
 * reads eight rows' worth of. So only the lists a row is actually on travel with the page; `want` names the extra
 * provider a row has just been moved to, and the App asks for that one the moment it needs it. A provider that is
 * asked for and has no list of a given kind comes back as an empty array rather than a missing key — that is how
 * the App tells "nothing here, type the id yourself" from "not fetched yet".
 */
export function modelsPage(rt: ModelRuntime | undefined, want?: string[]): ModelsPage {
  const providers: ProviderRow[] = [];
  const models: Record<string, ModelRow[]> = {};
  const need = new Set<string>(want ?? []);
  for (const def of SLOTS) {
    const p = providerOfSlot(def.id);
    if (p) need.add(p);
  }
  if (rt) {
    for (const p of rt.getProviders()) {
      // `faux` is the scripted stand-in, and `openrouter#visionModel` is a row's private clone of a real
      // provider (bots.ts) — neither is something to offer as a choice.
      if (p.id === 'faux' || p.id.includes('#')) continue;
      const list = rt.getModels(p.id);
      if (!list.length) continue;
      const auth = (p as unknown as { auth?: { apiKey?: { name?: string }; oauth?: { name?: string; loginLabel?: string; isSubscription?: boolean } } }).auth;
      providers.push({
        id: p.id,
        name: p.name || p.id,
        chat: true,
        apiKey: auth?.apiKey?.name,
        oauth: auth?.oauth ? { label: auth.oauth.loginLabel || auth.oauth.name || p.name, subscription: auth.oauth.isSubscription === true } : undefined,
        keyed: anyKeyFor(rt, p.id),
      });
      if (need.has(p.id)) models[p.id] = list.map(modelRow).sort((a, b) => a.id.localeCompare(b.id));
    }
    providers.sort((a, b) => (a.keyed && !b.keyed ? -1 : b.keyed && !a.keyed ? 1 : a.name.localeCompare(b.name)));
  }
  // The vendors pi does not carry sit at the end of the same list, marked `chat: false` so they are offered only
  // on the rows this server calls itself.
  for (const [id, p] of Object.entries(EXTRA_PROVIDERS)) providers.push({ id, name: p.name, chat: false, apiKey: p.apiKey, keyed: anyKeyFor(rt, id) });
  // Drawing, embedding, reranking and search do not read a provider's chat catalog, so their lists travel under
  // `<what the row needs>:<provider>` and the App asks for them by that key.
  for (const id of need) {
    models[`image:${id}`] = id === 'openrouter' ? imageModels() : (IMAGE_MODELS[id] ?? []);
    models[`embed:${id}`] = EMBED_MODELS[id] ?? [];
    models[`rerank:${id}`] = RERANK_MODELS[id] ?? [];
    // A search row at one of the extra vendors has no pi catalog to read, so its chat list is curated too.
    if (!models[id] && SEARCH_MODELS[id]) models[id] = SEARCH_MODELS[id];
  }
  const slots: SlotRow[] = SLOTS.map((def) => {
    const value = slotValue(def.id)?.trim() || undefined;
    const effective = effectiveOf(def.id);
    const got = keyOf(def.id);
    const own = config.slotKeys[def.id]?.trim();
    // A row is blocked when the model it would use has nobody paying for it. A row on automatic counts too:
    // drawing with no key is still drawing with no key.
    const blocked = effective !== 'off' && (!!effective || !!def.auto) && !got;
    return {
      ...def,
      value,
      effective,
      blocked,
      key: own ? '••••' : undefined,
      keyFrom: got?.source,
      pinned: slotPinned(def.id) || undefined,
      meta: effective ? config.modelMeta[effective] : undefined,
    };
  });
  return { slots, providers, models };
}

/** pi's catalogs are static until someone asks; the page's 「刷新」 is what asks. */
export async function refreshCatalog(rt: ModelRuntime | undefined): Promise<void> {
  if (!rt) return;
  await rt.refresh({});
}

/**
 * `embeddingModel` and `rerankModel` were bare model ids while there was only one place to send them. Now that the
 * row picks its own provider they are "provider/model-id" like everything else — and only pi can say whether the
 * first segment of an old value is a provider or the model vendor, so the rewrite happens here, once.
 */
export function migrateSlots(rt: ModelRuntime | undefined): void {
  if (!rt) return;
  const cur = readFileConfig() as Record<string, string | undefined>;
  const patch: Partial<Record<SlotId, string>> = {};
  for (const id of ['embeddingModel', 'rerankModel'] as const) {
    const v = cur[id]?.trim();
    if (!v || v === 'off') continue;
    const head = v.slice(0, v.indexOf('/'));
    if (head && rt.getProvider(head)) continue;
    patch[id] = `openrouter/${v}`;
  }
  if (Object.keys(patch).length) {
    saveModels({ slots: patch });
    console.log('[crew] 模型：向量和重排补上了 provider 前缀', JSON.stringify(patch));
  }
}

/**
 * Hand pi whatever the machine itself is paying with — the environment, and the older per-provider keys from
 * before the page existed. Rows with their own key do not come through here at all: pi holds one credential per
 * provider, so such a row is resolved onto a provider of its own instead (bots.ts `providerForSlot`). Runtime
 * keys are an in-memory overlay; config.json is where they live.
 */
export async function applyProviderKeys(rt: ModelRuntime | undefined): Promise<void> {
  if (!rt) return;
  const floor = new Map<string, string>();
  for (const [id, key] of Object.entries(config.providerKeys)) if (key?.trim()) floor.set(id, key.trim());
  for (const def of SLOTS) {
    const provider = providerOfSlot(def.id);
    const ambient = provider && !floor.has(provider) ? ambientKey(provider) : undefined;
    if (provider && ambient) floor.set(provider, ambient);
  }
  for (const [id, key] of floor) {
    if (!rt.getProvider(id)) continue;
    await rt.setRuntimeApiKey(id, key).catch((e: Error) => console.warn(`[crew] ${id} 的钥匙没被接受：`, e.message));
  }
}

/** The four rows the memory engine reads out of the environment it was started with (everos.ts). */
export const MEMORY_SLOTS: SlotId[] = ['model', 'lightModel', 'visionModel', 'embeddingModel', 'rerankModel'];

export interface ModelsPatch {
  slots?: Partial<Record<SlotId, string | null>>;
  /** row → the key that row uses; null takes it away, leaving the row on whatever the machine pays with */
  keys?: Partial<Record<SlotId, string | null>>;
  /** metadata for a model id the user typed by hand */
  meta?: Record<string, ModelInfo | null>;
}

/** Write what the page changed. Returns what has to be restarted for it to be true. */
export function saveModels(patch: ModelsPatch): { models: boolean; keys: boolean; memory: boolean } {
  const touched = { models: false, keys: false, memory: false };
  updateConfigFile((cur) => {
    for (const [k, v] of Object.entries(patch.slots ?? {})) {
      if (!SLOTS.some((s) => s.id === k)) continue;
      touched.models = true;
      if (MEMORY_SLOTS.includes(k as SlotId)) touched.memory = true;
      if (v === null || v === '') delete cur[k];
      // Switching a row off is the bare word, whatever a client sends: "voyage/off" would be a model named off.
      else cur[k] = /^(.*\/)?off$/.test(v) ? 'off' : v;
    }
    if (patch.keys) {
      const keys = { ...((cur.slotKeys as Record<string, string>) ?? {}) };
      for (const [id, v] of Object.entries(patch.keys)) {
        if (!SLOTS.some((s) => s.id === id)) continue;
        touched.keys = true;
        // The engine holds four of these in the environment it was spawned with.
        if (MEMORY_SLOTS.includes(id as SlotId)) touched.memory = true;
        if (v === null || v === '') delete keys[id];
        else keys[id] = v.trim();
      }
      cur.slotKeys = keys;
    }
    if (patch.meta) {
      const meta = { ...((cur.modelMeta as Record<string, ModelInfo>) ?? {}) };
      for (const [spec, v] of Object.entries(patch.meta)) {
        touched.models = true;
        if (v === null) delete meta[spec];
        else meta[spec] = v;
      }
      cur.modelMeta = meta;
    }
  });
  return touched;
}
