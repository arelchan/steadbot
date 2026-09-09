/**
 * The hosted cloud (our control plane): an anonymous account per browser, one home per account.
 * Configured with VITE_CREW_CLOUD (the control plane's public URL); absent → the option is hidden.
 */
export const cloudUrl = ((import.meta as unknown as { env: Record<string, string | undefined> }).env.VITE_CREW_CLOUD ?? '').replace(/\/$/, '');
export const cloudAvailable = !!cloudUrl;

const KEY = 'bot-crew:cloud';
interface CloudAccount {
  accountId: string;
  accountToken: string;
  homeId?: string;
}

export function getCloudAccount(): CloudAccount | undefined {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CloudAccount) : undefined;
  } catch {
    return undefined;
  }
}
const saveAccount = (a: CloudAccount) => localStorage.setItem(KEY, JSON.stringify(a));

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const r = await fetch(`${cloudUrl}${path}`, { ...init, headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}), ...(init.headers ?? {}) } });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error || `云端没有正常回应（${r.status}）`);
  return body;
}

/** Get (or create) this browser's account, then get (or create) its home. Returns what the move flow needs. */
export async function provisionCloudHome(name: string): Promise<{ id: string; url: string; token: string; name: string }> {
  let acct = getCloudAccount();
  if (!acct) {
    const a = await call<{ accountId: string; accountToken: string }>('/v1/accounts', { method: 'POST', body: '{}' });
    acct = { accountId: a.accountId, accountToken: a.accountToken };
    saveAccount(acct);
  }
  const home = await call<{ id: string; url: string; token: string; name: string }>('/v1/homes', { method: 'POST', token: acct.accountToken, body: JSON.stringify({ name }) });
  saveAccount({ ...acct, homeId: home.id });
  return home;
}

/** Whether this browser's account still has a home in the cloud (a copy may be left after moving back). */
export async function cloudHomeStatus(): Promise<{ id: string; url: string; name: string; running: boolean } | undefined> {
  const acct = getCloudAccount();
  if (!acct) return undefined;
  const homes = await call<{ id: string; url: string; name: string; running: boolean }[]>('/v1/homes', { token: acct.accountToken });
  return homes[0];
}

/** Destroy the cloud home (the control plane keeps one final backup). */
export async function destroyCloudHome(id: string): Promise<void> {
  const acct = getCloudAccount();
  if (!acct) throw new Error('没有云端账号');
  await call(`/v1/homes/${id}`, { method: 'DELETE', token: acct.accountToken });
  saveAccount({ accountId: acct.accountId, accountToken: acct.accountToken });
}
