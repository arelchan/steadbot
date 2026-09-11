import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { config } from './config.ts';
import { mimeOf } from './util.ts';
import { isOffice, officeBinary, officeToPdf } from './office.ts';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { basename, extname, join, normalize } from 'node:path';
import { execFile } from 'node:child_process';
import { WebSocketServer, WebSocket } from 'ws';
import type { CrewStore, StoreEvent } from './store.ts';
import type { ClientMessage, ServerMessage, Snapshot } from './types.ts';

export interface WsHandlers {
  snapshotMode: () => 'live' | 'fake';
  /** Extra snapshot fields not owned by the store (e.g. skills). */
  snapshotExtra?: () => Partial<Snapshot>;
  /** Extra HTTP routes (e.g. IM callbacks). Return true when handled. */
  http?: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
  onClient: (msg: ClientMessage, reply: (m: ServerMessage) => void) => void | Promise<void>;
  /** A computer offering its agents over `/host` (see host.ts). */
  onHost?: (socket: WebSocket) => void;
  /** A viewer of the bots' computer screen over `/vnc` (see desktop.ts); the handler completes the upgrade itself. */
  onVnc?: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

/** HTTP (avatars, health) + WebSocket (/ws) front door. Store changes fan out to every client. */
/** Token check: `Authorization: Bearer` or `?token=`. Without a configured token the server only listens on loopback, so everything is allowed. */
export function authorized(req: IncomingMessage): boolean {
  if (!config.authToken) return true;
  const h = req.headers.authorization;
  if (h && h.startsWith('Bearer ') && safeEq(h.slice(7), config.authToken)) return true;
  const t = new URL(req.url ?? '/', 'http://localhost').searchParams.get('token');
  return !!t && safeEq(t, config.authToken);
}
function safeEq(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
/** Routes anyone may hit: health, OAuth callbacks (carry their own state), IM webhooks (verified by signature). */
const PUBLIC_PATH = /^\/(health|oauth\/|wecom\/)/;

/**
 * 令牌也能走路径：`/tok/<token>/files/...`。
 *
 * 预览一份 HTML 交付物时，iframe 的地址带着 `?token=`，但页面里那些相对地址（`images/x.png`、
 * 自带的 css/js）不会继承查询串，于是全被 401 挡掉——图裂了、样式没上。令牌放在路径前缀里，相对地址
 * 天然就落在同一个前缀下面，整份东西才是完整的。查询串那种写法照常有效。
 */
function unprefix(req: IncomingMessage): void {
  const m = /^\/tok\/([^/]+)(\/.*)$/.exec(req.url ?? '');
  if (!m) return;
  req.url = m[2];
  if (config.authToken && safeEq(decodeURIComponent(m[1]), config.authToken)) req.headers.authorization = `Bearer ${config.authToken}`;
}

export function startServer(store: CrewStore, port: number, avatarsDir: string, handlers: WsHandlers) {
  const http = createServer(async (req, res) => {
    unprefix(req);
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'authorization,content-type' });
      return res.end();
    }
    if (!PUBLIC_PATH.test(path) && !authorized(req)) {
      res.writeHead(401, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ error: 'unauthorized' }));
    }
    try {
      if (handlers.http && (await handlers.http(req, res))) return;
    } catch (e) {
      console.error('[crew] http route failed:', e);
      if (!res.headersSent) res.writeHead(500);
      return res.end();
    }
    serveHttp(req, res, avatarsDir);
  });
  // Two WebSocket doors on one port: /ws for Apps, /host for the user's computer lending its agents. `ws` aborts
  // upgrades whose path is not its own when given `path`, so route the upgrade by hand instead.
  const wss = new WebSocketServer({ noServer: true });
  const hostWss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/vnc' && handlers.onVnc) {
      if (!authorized(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      handlers.onVnc(req, socket, head);
      return;
    }
    const target = path === '/ws' ? wss : path === '/host' && handlers.onHost ? hostWss : undefined;
    if (!target || !authorized(req)) {
      socket.write(`HTTP/1.1 ${target ? 401 : 404} ${target ? 'Unauthorized' : 'Not Found'}\r\n\r\n`);
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws, req));
  });

  // Credentials live in integration env; clients only ever see the key names.
  const redact = <T extends { env?: Record<string, string> }>(i: T): T => (i.env ? { ...i, env: Object.fromEntries(Object.keys(i.env).map((k) => [k, '••••'])) } : i);
  const redactMsg = (m: ServerMessage): ServerMessage => (m.type === 'integration' ? { ...m, integration: redact(m.integration) } : m);
  // IM traffic stays in the IM: messages and cards that came from a channel never reach App clients (the bot still has them in its one context).
  const fromIm = (via?: string) => !!via && via !== 'app';
  const broadcast = (m: ServerMessage) => {
    if (m.type === 'message' && fromIm(m.message.via)) return;
    if (m.type === 'pending' && fromIm(m.pending.via)) return;
    const data = JSON.stringify(redactMsg(m));
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
  };

  // Keepalive. A long-haul link (the App on a laptop, the bots on a cloud machine) sits behind NAT and carrier
  // boxes that drop idle TCP without telling anyone; without a ping the App only finds out when it next tries to
  // speak, and looks disconnected for no reason. Ping every 30 s and drop peers that stop answering.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const c of [...wss.clients, ...hostWss.clients]) {
      if (c.readyState !== WebSocket.OPEN) continue;
      if (!alive.has(c)) {
        c.terminate();
        continue;
      }
      alive.delete(c);
      try {
        c.ping();
      } catch {
        /* it is going away anyway */
      }
    }
  }, 30_000);
  heartbeat.unref?.();
  hostWss.on('connection', (socket) => {
    // The computer lending its agents is on the same kind of long-haul link as the Apps: same heartbeat, so a
    // laptop that went to sleep stops counting as online within a minute instead of until its TCP times out.
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    handlers.onHost?.(socket);
  });

  store.on('change', (e: StoreEvent) => broadcast(e as ServerMessage));

  wss.on('connection', (socket) => {
    alive.add(socket);
    socket.on('pong', () => alive.add(socket));
    const reply = (m: ServerMessage) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(m));
    reply({
      type: 'snapshot',
      state: { ...store.data, messages: store.data.messages.filter((m) => !fromIm(m.via)), pendings: store.data.pendings.filter((p) => !fromIm(p.via)), integrations: store.data.integrations.map(redact), ...(handlers.snapshotExtra?.() ?? {}) },
      mode: handlers.snapshotMode(),
    });
    socket.on('message', async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        return reply({ type: 'error', error: 'bad json' });
      }
      try {
        await handlers.onClient(msg, reply);
      } catch (e) {
        console.error('[crew] client message failed:', e);
        reply({ type: 'error', error: (e as Error).message });
      }
    });
  });

  http.listen(port, config.bind, () => console.log(`[crew] listening on ${config.bind}:${port}${config.authToken ? ' (token required)' : ' (loopback only, no token)'}  ws path /ws`));
  return { http, wss, broadcast };
}

function serveHttp(req: IncomingMessage, res: ServerResponse, avatarsDir: string) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  res.setHeader('access-control-allow-origin', '*');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname.startsWith('/open/') && req.method === 'POST') {
    // /open/<botId>/<path>?reveal=1: hand a bot's deliverable to the desktop (default app, or reveal in Finder).
    // Same boundary as /files; script-like files are only ever revealed, never launched.
    const file = botFile(url.pathname.slice('/open/'.length));
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    const reveal = url.searchParams.get('reveal') === '1' || NEVER_LAUNCH.test(extname(file));
    openOnDesktop(file, reveal, (err) => {
      res.writeHead(err ? 500 : 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(err ? { ok: false, error: err.message } : { ok: true, mode: reveal ? 'reveal' : 'open' }));
    });
    return;
  }
  if (url.pathname.startsWith('/preview/')) {
    // /preview/<botId>/<path>: an Office file as a PDF, so the app can show a deck or a document in place.
    const file = botFile(url.pathname.slice('/preview/'.length));
    if (!file || !isOffice(file)) {
      res.writeHead(404);
      return res.end();
    }
    const fail = (code: number, error: string) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error }));
    };
    if (!officeBinary()) return fail(501, 'no-libreoffice');
    officeToPdf(file).then(
      (pdf) => {
        res.writeHead(200, {
          'content-type': 'application/pdf',
          'content-length': statSync(pdf).size,
          'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(basename(file, extname(file)))}.pdf`,
          'cache-control': 'private, max-age=3600',
        });
        createReadStream(pdf).pipe(res);
      },
      (e: Error) => fail(500, e.message),
    );
    return;
  }
  if (url.pathname.startsWith('/files/')) {
    // /files/<botId>/<path under the bot dir>: read-only delivery of what a bot produced. Sessions and memory stay private.
    const file = botFile(url.pathname.slice('/files/'.length));
    if (!file) {
      res.writeHead(404);
      return res.end();
    }
    const mime = mimeOf(file);
    const inline = /^(text\/|image\/|application\/(pdf|json)|video\/|audio\/)/.test(mime);
    res.writeHead(200, {
      'content-type': mime,
      'content-length': statSync(file).size,
      'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(basename(file))}`,
      'cache-control': 'no-cache',
    });
    return createReadStream(file).pipe(res);
  }
  if (url.pathname.startsWith('/avatars/')) {
    const file = normalize(join(avatarsDir, url.pathname.slice('/avatars/'.length)));
    if (!file.startsWith(avatarsDir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': file.endsWith('.jpg') ? 'image/jpeg' : 'image/png', 'cache-control': 'public, max-age=86400' });
    return createReadStream(file).pipe(res);
  }
  res.writeHead(404);
  res.end();
}

/** Resolve `<botId>/<path>` to a file inside that bot's dir, or undefined. Sessions and memory stay private. */
function botFile(spec: string): string | undefined {
  const [botId, ...rest] = spec.split('/').map((seg) => decodeURIComponent(seg));
  if (!botId) return undefined;
  const botDir = normalize(join(config.botsDir, botId));
  const file = normalize(join(botDir, ...rest));
  const rel = file.slice(botDir.length + 1);
  if (!file.startsWith(botDir + '/') || rel.startsWith('sessions/') || rel === 'MEMORY.md' || !existsSync(file) || !statSync(file).isFile()) return undefined;
  return file;
}

/** Things `open` would execute rather than display: never launch these, only reveal them. */
const NEVER_LAUNCH = /^\.(sh|bash|zsh|command|tool|app|pkg|dmg|scpt|applescript|jar|exe|bat|cmd|ps1|workflow)$/i;
/** Code and data files go to the default text editor rather than whatever claims the extension (e.g. .py → a terminal). */
const AS_TEXT = /^\.(js|mjs|cjs|ts|tsx|py|rb|go|rs|json|yaml|yml|toml|xml|mmd|txt|log|env|ini|cfg)$/i;

function openOnDesktop(file: string, reveal: boolean, done: (err?: Error) => void) {
  const ext = extname(file);
  const cb = (err: Error | null) => done(err ?? undefined);
  if (process.platform === 'darwin') {
    const args = reveal ? ['-R', file] : AS_TEXT.test(ext) ? ['-t', file] : [file];
    return execFile('open', args, cb);
  }
  if (process.platform === 'win32') return execFile('explorer', [reveal ? `/select,${file}` : file], cb);
  return execFile('xdg-open', [reveal ? join(file, '..') : file], cb);
}
