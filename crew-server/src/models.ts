import type { Api, Model } from '@earendil-works/pi-ai';
import { builtinImagesModels } from '@earendil-works/pi-ai/providers/all';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_RERANK_MODEL, config, readFileConfig, updateConfigFile, type ModelInfo } from './config.ts';
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
  /** rows that can only be served by one provider (see the note above) */
  only?: string;
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
  { id: 'imageModel', needs: 'image', only: 'openrouter', auto: true },
  { id: 'searchModel', needs: 'chat', only: 'openrouter', inherits: 'lightModel' },
  { id: 'embeddingModel', needs: 'embed', only: 'openrouter', fallback: DEFAULT_EMBEDDING_MODEL },
  { id: 'rerankModel', needs: 'rerank', only: 'openrouter', fallback: DEFAULT_RERANK_MODEL, offable: true },
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
  /** model lists, by provider id; only for providers that can actually be reached */
  models: Record<string, ModelRow[]>;
}

/** The four rows pinned to OpenRouter draw from these lists instead of a chat catalog. */
const imagesCatalog = builtinImagesModels();

/** Embedding and rerank models are not in anybody's chat catalog; these are the ones this product has run on. */
const EMBED_MODELS: ModelRow[] = [
  { id: 'baai/bge-m3', name: 'BGE-M3', vision: false },
  { id: 'qwen/qwen3-embedding-8b', name: 'Qwen3 Embedding 8B', vision: false },
  { id: 'openai/text-embedding-3-large', name: 'OpenAI text-embedding-3-large', vision: false },
];
const RERANK_MODELS: ModelRow[] = [
  { id: 'cohere/rerank-v3.5', name: 'Cohere Rerank 3.5', vision: false },
  { id: 'baai/bge-reranker-v2-m3', name: 'BGE Reranker v2-m3', vision: false },
];

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
  // The pinned rows: their model lists do not come from a provider's chat catalog, so they travel under the
  // slot's own name rather than a provider id.
  models.imageModel = imageModels();
  models.embeddingModel = EMBED_MODELS;
  models.rerankModel = RERANK_MODELS;
  const slots: SlotRow[] = SLOTS.map((def) => {
    const value = slotValue(def.id)?.trim() || undefined;
    const effective = effectiveOf(def.id);
    // A row is blocked when the model it would use has nobody paying for it. The pinned rows are blocked by the
    // same rule even when they are on automatic: drawing with no OpenRouter key is still drawing with no key.
    const providerId = def.only ?? splitSpec(effective)?.provider;
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
