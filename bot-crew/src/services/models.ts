import { httpBase, authHeaders, remember, remembered } from './runtime';
import type { ModelsPage, ModelsPatch } from '../types';

/**
 * 设置 › 模型 talks to the server over HTTP rather than the websocket: nobody else in the App needs any of it, and
 * it is asked for only while the window is open.
 *
 * Two things keep that from being a wait every time. The page arrives with only the model lists its eight rows are
 * on — a provider's catalog is fetched when a row moves to it — and the last answer is kept, in this browser and
 * not just in this tab, so opening the page draws the rows at once and the fetch behind it only corrects them.
 */
const url = (want?: string) => `${httpBase || window.location.origin}/models${want ? `?for=${encodeURIComponent(want)}` : ''}`;

let cached: { at: string; page: ModelsPage } | undefined = (() => {
  const page = remembered<ModelsPage>('models');
  return page ? { at: httpBase || window.location.origin, page } : undefined;
})();

/** The lists already fetched stay; a page that did not carry them is not a page that says they are gone. */
function keep(page: ModelsPage): ModelsPage {
  const at = httpBase || window.location.origin;
  const models = cached?.at === at ? { ...cached.page.models, ...page.models } : page.models;
  cached = { at, page: { ...page, models } };
  remember('models', cached.page);
  return cached.page;
}

/** What the last visit ended up with, to draw while this visit's answer is still on the way. */
export const lastModels = (): ModelsPage | undefined => (cached?.at === (httpBase || window.location.origin) ? cached.page : undefined);

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
