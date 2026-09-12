import { httpBase, authHeaders } from './runtime';
import type { ModelsPage, ModelsPatch } from '../types';

/**
 * 设置 › 模型 talks to the server over HTTP rather than the websocket: nobody else in the App needs any of it, and
 * it is asked for only while the window is open.
 *
 * Two things keep that from being a wait every time. The page arrives with only the model lists its eight rows are
 * on — a provider's catalog is fetched when a row moves to it — and the last answer is kept here, so reopening the
 * window draws the rows at once and the fetch behind it only corrects them.
 */
const url = (want?: string) => `${httpBase || window.location.origin}/models${want ? `?for=${encodeURIComponent(want)}` : ''}`;

let cached: { at: string; page: ModelsPage } | undefined;

/** The lists already fetched stay; a page that did not carry them is not a page that says they are gone. */
function keep(page: ModelsPage): ModelsPage {
  const at = httpBase || window.location.origin;
  const models = cached?.at === at ? { ...cached.page.models, ...page.models } : page.models;
  cached = { at, page: { ...page, models } };
  return cached.page;
}

/** What the last visit ended up with, to draw while this visit's answer is still on the way. */
export const lastModels = (): ModelsPage | undefined => (cached?.at === (httpBase || window.location.origin) ? cached.page : undefined);

async function call(want?: string, init?: RequestInit): Promise<ModelsPage> {
  const r = await fetch(url(want), { ...init, headers: { 'content-type': 'application/json', ...authHeaders() } });
  if (!r.ok) throw new Error(r.status === 404 ? 'old' : String(r.status));
  return keep((await r.json()) as ModelsPage);
}

export const fetchModels = (want?: string) => call(want);
export const saveModels = (patch: ModelsPatch) => call(undefined, { method: 'POST', body: JSON.stringify(patch) });
/** Ask the providers for their current model lists (pi ships a static catalog that new models are not in yet). */
export const refreshModels = () => call(undefined, { method: 'POST', body: JSON.stringify({ refresh: true }) });
