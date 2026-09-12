import { httpBase, authHeaders } from './runtime';
import type { UsageReport } from '../types';

/**
 * 设置 › 用量. One request at a time: the settings window warms it the moment it opens and the tab asks for the
 * same thing when it is clicked, so by then it is usually already here — and until it is, the tab draws a
 * skeleton rather than last time's numbers, which for money is the difference between waiting and being misled.
 */
let inflight: Promise<UsageReport> | undefined;

export function fetchUsage(days = 30): Promise<UsageReport> {
  if (!inflight) inflight = read(days).finally(() => (inflight = undefined));
  return inflight;
}

async function read(days: number): Promise<UsageReport> {
  const r = await fetch(`${httpBase || window.location.origin}/usage?days=${days}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(r.status === 404 ? 'old' : String(r.status));
  return (await r.json()) as UsageReport;
}
