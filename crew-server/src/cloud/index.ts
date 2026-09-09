import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { connect as netConnect } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DockerDriver, ProcessDriver, type Driver, type HomeSpec } from './drivers.ts';

/**
 * The hosted "cloud" control plane: one crew-server per user, all behind this one address.
 *
 *   POST   /v1/accounts            → { accountId, accountToken }          (anonymous account; the App keeps the token)
 *   POST   /v1/homes               → { id, url, token, name }             (Bearer accountToken; one home per account)
 *   GET    /v1/homes               → [{ id, url, name, running }]
 *   DELETE /v1/homes/:id           → destroys the tenant server and its data (a final backup is kept)
 *   ANY    /t/:id/*                → proxied to that tenant's server, prefix stripped, WebSocket included
 *
 * Tenants are started on first request if stopped ("wake on request"); backups run nightly.
 * Environment: CLOUD_PORT (5300), CLOUD_PUBLIC_URL, CLOUD_DATA (state dir), CLOUD_DRIVER=docker|process,
 * CLOUD_IMAGE (docker image), CLOUD_ADMIN_TOKEN (optional: GET /v1/admin/homes).
 */

const PORT = Number(process.env.CLOUD_PORT ?? 5300);
const PUBLIC_URL = (process.env.CLOUD_PUBLIC_URL ?? `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.CLOUD_DATA ?? join(process.env.HOME ?? '/tmp', '.crew-cloud');
const DRIVER = (process.env.CLOUD_DRIVER ?? 'process') as 'docker' | 'process';
const IMAGE = process.env.CLOUD_IMAGE ?? 'crew-server:local';
const ADMIN = process.env.CLOUD_ADMIN_TOKEN;
const PORT_BASE = Number(process.env.CLOUD_TENANT_PORT_BASE ?? 5400);
const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Account {
  id: string;
  token: string;
  createdAt: number;
}
interface Home extends HomeSpec {
  accountId: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
}
interface State {
  accounts: Account[];
  homes: Home[];
}

mkdirSync(join(DATA, 'backups'), { recursive: true });
const statePath = join(DATA, 'cloud.json');
const state: State = existsSync(statePath) ? (JSON.parse(readFileSync(statePath, 'utf8')) as State) : { accounts: [], homes: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
const driver: Driver = DRIVER === 'docker' ? new DockerDriver(IMAGE) : new ProcessDriver(DATA, serverDir);

const newId = () => randomBytes(5).toString('hex');
const newToken = () => randomBytes(24).toString('hex');
const freePort = () => {
  const used = new Set(state.homes.map((h) => h.port));
  let p = PORT_BASE;
  while (used.has(p)) p++;
  return p;
};
const tenantUrl = (id: string) => `${PUBLIC_URL}/t/${id}`;

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
};
const bearer = (req: IncomingMessage) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};
const accountOf = (req: IncomingMessage) => {
  const t = bearer(req);
  return t ? state.accounts.find((a) => a.token === t) : undefined;
};
const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });

async function waitHealthy(h: HomeSpec, ms = 60_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${h.port}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

/* ---------------- API ---------------- */

async function api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' });
    res.end();
    return true;
  }
  if (url.pathname === '/health') return json(res, 200, { ok: true, driver: driver.kind, homes: state.homes.length }), true;

  if (url.pathname === '/v1/accounts' && req.method === 'POST') {
    const a: Account = { id: newId(), token: newToken(), createdAt: Date.now() };
    state.accounts.push(a);
    save();
    return json(res, 200, { accountId: a.id, accountToken: a.token }), true;
  }
  if (url.pathname === '/v1/admin/homes' && req.method === 'GET') {
    if (!ADMIN || bearer(req) !== ADMIN) return json(res, 401, { error: 'unauthorized' }), true;
    const list = await Promise.all(state.homes.map(async (h) => ({ id: h.id, accountId: h.accountId, name: h.name, port: h.port, createdAt: h.createdAt, lastSeenAt: h.lastSeenAt, running: await driver.isRunning(h) })));
    return json(res, 200, list), true;
  }
  if (url.pathname.startsWith('/v1/')) {
    const acct = accountOf(req);
    if (!acct) return json(res, 401, { error: '账号无效' }), true;
    if (url.pathname === '/v1/homes' && req.method === 'POST') {
      let h = state.homes.find((x) => x.accountId === acct.id);
      if (!h) {
        const body = JSON.parse((await readBody(req)) || '{}') as { name?: string };
        const id = newId();
        h = { id, accountId: acct.id, port: freePort(), token: newToken(), publicUrl: tenantUrl(id), name: (body.name ?? '云端').slice(0, 40), createdAt: Date.now(), lastSeenAt: Date.now() };
        state.homes.push(h);
        save();
      }
      try {
        await driver.ensureRunning(h);
      } catch (e) {
        return json(res, 502, { error: `机器没起来：${(e as Error).message.slice(0, 200)}` }), true;
      }
      if (!(await waitHealthy(h))) return json(res, 504, { error: '机器起来了但没有响应' }), true;
      return json(res, 200, { id: h.id, url: h.publicUrl, token: h.token, name: h.name }), true;
    }
    if (url.pathname === '/v1/homes' && req.method === 'GET') {
      const mine = state.homes.filter((x) => x.accountId === acct.id);
      return json(res, 200, await Promise.all(mine.map(async (h) => ({ id: h.id, url: h.publicUrl, name: h.name, running: await driver.isRunning(h), createdAt: h.createdAt })))), true;
    }
    const m = /^\/v1\/homes\/([a-z0-9]+)$/.exec(url.pathname);
    if (m && req.method === 'DELETE') {
      const h = state.homes.find((x) => x.id === m[1] && x.accountId === acct.id);
      if (!h) return json(res, 404, { error: '没有这个家' }), true;
      try {
        await driver.backup(h, join(DATA, 'backups', `${h.id}-final-${Date.now()}.tar.gz`));
      } catch (e) {
        console.warn('[cloud] final backup failed:', (e as Error).message);
      }
      await driver.destroy(h);
      state.homes = state.homes.filter((x) => x.id !== h.id);
      save();
      return json(res, 200, { ok: true }), true;
    }
    return json(res, 404, { error: 'not found' }), true;
  }
  return false;
}

/* ---------------- proxy ---------------- */

const tenantFor = (path: string) => {
  const m = /^\/t\/([a-z0-9]+)(\/.*)?$/.exec(path);
  if (!m) return undefined;
  const h = state.homes.find((x) => x.id === m[1]);
  return h ? { h, rest: m[2] || '/' } : undefined;
};

async function wake(h: Home) {
  if (await driver.isRunning(h)) return true;
  console.log(`[cloud] waking ${h.id}`);
  await driver.ensureRunning(h);
  return waitHealthy(h);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  try {
    if (await api(req, res, url)) return;
  } catch (e) {
    console.error('[cloud] api failed:', e);
    if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    return;
  }
  const t = tenantFor(url.pathname);
  if (!t) return json(res, 404, { error: 'not found' });
  if (!(await wake(t.h))) return json(res, 503, { error: '这台机器暂时起不来' });
  t.h.lastSeenAt = Date.now();
  const up = httpRequest(
    { host: '127.0.0.1', port: t.h.port, method: req.method, path: t.rest + url.search, headers: { ...req.headers, host: `127.0.0.1:${t.h.port}` } },
    (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) json(res, 502, { error: '机器没有回应' });
  });
  req.pipe(up);
});

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url ?? '/', PUBLIC_URL);
  const t = tenantFor(url.pathname);
  if (!t) return socket.destroy();
  if (!(await wake(t.h))) return socket.destroy();
  t.h.lastSeenAt = Date.now();
  const upstream = netConnect(t.h.port, '127.0.0.1', () => {
    const lines = [`${req.method} ${t.rest + url.search} HTTP/1.1`];
    for (const [k, v] of Object.entries(req.headers)) {
      if (k === 'host') continue;
      lines.push(`${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
    }
    lines.push(`host: 127.0.0.1:${t.h.port}`, '', '');
    upstream.write(lines.join('\r\n'));
    if (head.length) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error', () => socket.destroy());
  socket.on('error', () => upstream.destroy());
});

/* ---------------- housekeeping ---------------- */

async function nightlyBackups() {
  for (const h of state.homes) {
    const out = join(DATA, 'backups', `${h.id}-${new Date().toISOString().slice(0, 10)}.tar.gz`);
    if (existsSync(out)) continue;
    try {
      await driver.backup(h, out);
    } catch (e) {
      console.warn(`[cloud] backup ${h.id} failed:`, (e as Error).message);
    }
  }
  // Keep 7 per tenant (final backups are never pruned).
  for (const h of state.homes) {
    const mine = readdirSync(join(DATA, 'backups')).filter((n) => n.startsWith(`${h.id}-`) && !n.includes('-final-')).sort();
    for (const n of mine.slice(0, Math.max(0, mine.length - 7))) rmSync(join(DATA, 'backups', n), { force: true });
  }
}
setInterval(() => void nightlyBackups(), 60 * 60 * 1000);

server.listen(PORT, process.env.CLOUD_BIND ?? '0.0.0.0', async () => {
  console.log(`[cloud] control plane on :${PORT} (${driver.kind}), public ${PUBLIC_URL}, ${state.homes.length} homes`);
  for (const h of state.homes) {
    try {
      await driver.ensureRunning(h);
    } catch (e) {
      console.warn(`[cloud] could not start ${h.id}:`, (e as Error).message);
    }
  }
});
