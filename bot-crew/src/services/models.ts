import { httpBase, authHeaders } from './runtime';
import type { ModelsPage, ModelsPatch } from '../types';

/**
 * 设置 › 模型 talks to the server over HTTP rather than the websocket: nobody else in the App needs any of it, and
 * it is asked for only while the window is open.
 *
 * The page arrives with only the model lists its eight rows are on; a provider's catalog is fetched when a row
 * moves to it, and the ones already fetched are kept here so moving back is free. What the page *says* — which
 * model, whose key — is never drawn from that: it is the server's answer or it is a skeleton.
 */
const url = (want?: string) => `${httpBase || window.location.origin}/models${want ? `?for=${encodeURIComponent(want)}` : ''}`;

let cached: { at: string; page: ModelsPage } | undefined;

/**
 * A page pushed over the socket goes through the same merge as one that was fetched: the server sends the lists
 * the eight rows are on, and whatever else this session has already looked up stays.
 */
export const absorbModels = (page: ModelsPage): ModelsPage => keep(page);

/** The lists already fetched stay; a page that did not carry them is not a page that says they are gone. */
function keep(page: ModelsPage): ModelsPage {
  const at = httpBase || window.location.origin;
  const models = cached?.at === at ? { ...cached.page.models, ...page.models } : page.models;
  cached = { at, page: { ...page, models } };
  return cached.page;
}

async function call(want?: string, init?: RequestInit): Promise<ModelsPage> {
  const r = await fetch(url(want), { ...init, headers: { 'content-type': 'application/json', ...authHeaders() } });
  if (!r.ok) throw new Error(r.status === 404 ? 'old' : String(r.status));
  return keep((await r.json()) as ModelsPage);
}

/** One request at a time for the page itself: the settings window warms it, and the tab asks for it again. */
let inflight: Promise<ModelsPage> | undefined;
export const fetchModels = (want?: string) => {
  if (want) return call(want);
  if (!inflight) inflight = call().finally(() => (inflight = undefined));
  return inflight;
};
/** `want` rides along with the save: moving a row to another vendor is one round trip, not a save and then a fetch. */
export const saveModels = (patch: ModelsPatch, want?: string) => call(want, { method: 'POST', body: JSON.stringify(patch) });
