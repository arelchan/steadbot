import type { Api, Model } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_RERANK_MODEL, config, orKey, readFileConfig, updateConfigFile, type ModelInfo } from './config.ts';
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
  /** left empty, this row borrows another one */
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
  { id: 'imageModel', needs: 'image', only: ['openrouter'], auto: true },
  { id: 'searchModel', needs: 'chat', only: ['openrouter'], inherits: 'lightModel' },
  { id: 'embeddingModel', needs: 'embed', fallback: DEFAULT_EMBEDDING_MODEL },
  { id: 'rerankModel', needs: 'rerank', fallback: DEFAULT_RERANK_MODEL, offable: true },
];

export interface ProviderRow {
  id: string;
  name: string;
  /** false when this provider cannot be picked for anything (no models pi can talk to) */
  chat: boolean;
  apiKey?: string;
  /** the provider offers a sign-in instead of a key; `subscription` means an existing plan counts */
  oauth?: { label: string; subscription: boolean };
  /** where the key it is using came from, in the user's words */
  keyed?: 'app' | 'env' | 'login';
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
const EMBED_MODELS: Record<string, ModelRow[]> = {
  openrouter: [
    { id: 'baai/bge-m3', name: 'BGE-M3', vision: false },
    { id: 'qwen/qwen3-embedding-8b', name: 'Qwen3 Embedding 8B', vision: false },
  ],
  openai: [
    { id: 'text-embedding-3-large', name: 'text-embedding-3-large', vision: false },
    { id: 'text-embedding-3-small', name: 'text-embedding-3-small', vision: false },
  ],
};
const RERANK_MODELS: Record<string, ModelRow[]> = {
  openrouter: [
    { id: 'cohere/rerank-v3.5', name: 'Cohere Rerank 3.5', vision: false },
    { id: 'baai/bge-reranker-v2-m3', name: 'BGE Reranker v2-m3', vision: false },
  ],
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
 * Where to send one of our own HTTP calls — embeddings and reranking, which pi has no concept of. The provider's
 * base URL comes from pi, the key from what the user typed (or, for OpenRouter, the environment).
 */
export function endpointOf(spec: string | undefined): { provider: string; model: string; baseUrl: string; key: string } | undefined {
  const s = splitSpec(spec);
  if (!s || s.id === 'off') return undefined;
  const baseUrl = runtime?.getProvider(s.provider)?.baseUrl;
  const key = s.provider === 'openrouter' ? orKey() : config.providerKeys[s.provider]?.trim();
  return baseUrl && key ? { provider: s.provider, model: s.id, baseUrl: baseUrl.replace(/\/$/, ''), key } : undefined;
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

/** Follow inheritance and defaults to the model that will actually run. */
export function effectiveOf(id: SlotId, seen = new Set<SlotId>()): string | undefined {
  if (seen.has(id)) return undefined;
  seen.add(id);
  const def = SLOTS.find((s) => s.id === id)!;
  const own = slotValue(id)?.trim();
  if (own) return own;
  if (def.inherits) return effectiveOf(def.inherits, seen);
  return def.fallback;
}

/** Whether a provider has a key behind it right now, and where that key came from. */
function keyedFrom(rt: ModelRuntime, id: string): ProviderRow['keyed'] {
  if (config.providerKeys[id]?.trim()) return 'app';
  const st = rt.getProviderAuthStatus(id);
  if (!st.configured) return undefined;
  return st.source === 'stored' || st.source === 'runtime' ? 'login' : 'env';
}

/** Everything 设置 › 模型 draws, in one answer. */
export function modelsPage(rt: ModelRuntime | undefined): ModelsPage {
  const providers: ProviderRow[] = [];
  const models: Record<string, ModelRow[]> = {};
  if (rt) {
    for (const p of rt.getProviders()) {
      if (p.id === 'faux') continue;
      const list = rt.getModels(p.id);
      if (!list.length) continue;
      const auth = (p as unknown as { auth?: { apiKey?: { name?: string }; oauth?: { name?: string; loginLabel?: string; isSubscription?: boolean } } }).auth;
      providers.push({
        id: p.id,
        name: p.name || p.id,
        chat: true,
        apiKey: auth?.apiKey?.name,
        oauth: auth?.oauth ? { label: auth.oauth.loginLabel || auth.oauth.name || p.name, subscription: auth.oauth.isSubscription === true } : undefined,
        keyed: keyedFrom(rt, p.id),
      });
      models[p.id] = list.map(modelRow).sort((a, b) => a.id.localeCompare(b.id));
    }
    providers.sort((a, b) => (a.keyed && !b.keyed ? -1 : b.keyed && !a.keyed ? 1 : a.name.localeCompare(b.name)));
  }
  // Drawing, embedding and reranking do not read a provider's chat catalog, so their lists travel under
  // `<what the row needs>:<provider>` and the App asks for them by that key.
  models['image:openrouter'] = imageModels();
  for (const [id, rows] of Object.entries(EMBED_MODELS)) models[`embed:${id}`] = rows;
  for (const [id, rows] of Object.entries(RERANK_MODELS)) models[`rerank:${id}`] = rows;
  const slots: SlotRow[] = SLOTS.map((def) => {
    const value = slotValue(def.id)?.trim() || undefined;
    const effective = effectiveOf(def.id);
    // A row is blocked when the model it would use has nobody paying for it. The pinned rows are blocked by the
    // same rule even when they are on automatic: drawing with no OpenRouter key is still drawing with no key.
    const providerId = splitSpec(effective)?.provider ?? (def.only?.length === 1 ? def.only[0] : undefined);
    const keyed = !providerId || !!providers.find((p) => p.id === providerId)?.keyed;
    const blocked = effective !== 'off' && (!!effective || !!def.auto) && !keyed;
    return { ...def, value, effective, blocked, pinned: slotPinned(def.id) || undefined, meta: effective ? config.modelMeta[effective] : undefined };
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

/** Hand pi every key the user typed. Runtime keys are an in-memory overlay; config.json is where they live. */
export async function applyProviderKeys(rt: ModelRuntime | undefined): Promise<void> {
  if (!rt) return;
  for (const [id, key] of Object.entries(config.providerKeys)) {
    if (!key?.trim() || !rt.getProvider(id)) continue;
    await rt.setRuntimeApiKey(id, key.trim()).catch((e: Error) => console.warn(`[crew] ${id} 的钥匙没被接受：`, e.message));
  }
}

export interface ModelsPatch {
  slots?: Partial<Record<SlotId, string | null>>;
  /** provider id → key; null removes it */
  keys?: Record<string, string | null>;
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
      if (k === 'embeddingModel' || k === 'rerankModel' || k === 'visionModel' || k === 'lightModel') touched.memory = true;
      if (v === null || v === '') delete cur[k];
      else cur[k] = v;
    }
    if (patch.keys) {
      const keys = { ...((cur.providerKeys as Record<string, string>) ?? {}) };
      for (const [id, v] of Object.entries(patch.keys)) {
        touched.keys = true;
        if (id === 'openrouter') touched.memory = true;
        if (v === null || v === '') delete keys[id];
        else keys[id] = v.trim();
      }
      cur.providerKeys = keys;
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
