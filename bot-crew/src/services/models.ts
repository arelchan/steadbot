import { httpBase, authHeaders } from './runtime';
import type { ModelsPage, ModelsPatch } from '../types';

/**
 * 设置 › 模型 talks to the server over HTTP rather than the websocket: the answer is a few hundred model
 * entries that nobody else needs, and it is asked for only while the window is open.
 */
const url = () => `${httpBase || window.location.origin}/models`;

async function call(init?: RequestInit): Promise<ModelsPage> {
  const r = await fetch(url(), { ...init, headers: { 'content-type': 'application/json', ...authHeaders() } });
  if (!r.ok) throw new Error(r.status === 404 ? 'old' : String(r.status));
  return (await r.json()) as ModelsPage;
}

export const fetchModels = () => call();
export const saveModels = (patch: ModelsPatch) => call({ method: 'POST', body: JSON.stringify(patch) });
/** Ask the providers for their current model lists (pi ships a static catalog that new models are not in yet). */
export const refreshModels = () => call({ method: 'POST', body: JSON.stringify({ refresh: true }) });
