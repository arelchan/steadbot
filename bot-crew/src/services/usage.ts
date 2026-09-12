import { httpBase, authHeaders, remember, remembered } from './runtime';
import type { UsageReport } from '../types';

/**
 * 设置 › 用量. Like the models page: what it said last time is drawn immediately and corrected when this time's
 * answer lands, so the tab never opens on 「读取中…」 after the first visit.
 */
const WHAT = 'usage';

export const lastUsage = (): UsageReport | undefined => remembered<UsageReport>(WHAT);

/** One request at a time: the settings window warms this, and the tab asks for it again when it opens. */
let inflight: Promise<UsageReport> | undefined;

export function fetchUsage(days = 30): Promise<UsageReport> {
  if (!inflight) inflight = read(days).finally(() => (inflight = undefined));
  return inflight;
}

async function read(days: number): Promise<UsageReport> {
  const r = await fetch(`${httpBase || window.location.origin}/usage?days=${days}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(r.status === 404 ? 'old' : String(r.status));
  const report = (await r.json()) as UsageReport;
  remember(WHAT, report);
  return report;
}
