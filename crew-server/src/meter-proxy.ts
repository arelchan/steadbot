/**
 * The memory engine spends on the same key, and until now nobody could say how much.
 *
 * everos is its own process: we used to hand it the key through the environment and it talked to the provider
 * directly — memory extraction, embeddings, rerank, document parsing. None of that could reach the ledger, and by
 * the shape of the work it is not small. So its four base URLs point here instead: a loopback forwarder that adds
 * the real key, passes the response through untouched, and files what the response says it cost. The sidecar now
 * holds a placeholder instead of a credential, which is the second reason to do it this way.
 *
 * Each leg can be on a different provider now (设置 › 模型 lets the embedding row pick its own), so the base URL
 * handed over carries the provider id — `http://127.0.0.1:<port>/<provider>` — and the first path segment is what
 * picks the upstream and the key.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { recordRaw } from './meter.ts';
import { endpointOf } from './models.ts';

export const PLACEHOLDER = 'metered-by-crew';

let server: Server | undefined;
let base: string | undefined;

/** Usage as every OpenAI-shaped response reports it, whether it came in one piece or as the last SSE frame. */
function usageOf(body: string, stream: boolean): { model?: string; input: number; output: number; cost?: number } | undefined {
  const read = (o: Record<string, unknown>) => {
    const u = o.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; cost?: number } | undefined;
    if (!u) return undefined;
    return {
      model: typeof o.model === 'string' ? o.model : undefined,
      input: u.prompt_tokens ?? 0,
      output: u.completion_tokens ?? 0,
      cost: typeof u.cost === 'number' ? u.cost : undefined,
    };
  };
  if (!stream) {
    try {
      return read(JSON.parse(body) as Record<string, unknown>);
    } catch {
      return undefined;
    }
  }
  // The usage frame is the last one before [DONE]; scan backwards so a long stream costs one pass at most.
  const lines = body.split('\n').filter((l) => l.startsWith('data: ') && !l.includes('[DONE]'));
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const got = read(JSON.parse(lines[i].slice(6)) as Record<string, unknown>);
      if (got) return got;
    } catch {
      /* keep scanning */
    }
  }
  return undefined;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const raw = (req.url ?? '/').replace(/^\/+/, '');
  const slash = raw.indexOf('/');
  const provider = slash > 0 ? raw.slice(0, slash) : raw;
  const path = slash > 0 ? raw.slice(slash + 1) : '';
  // `<provider>/x` is enough to resolve both ends: pi knows the base URL, we know the key.
  const at = endpointOf(`${provider}/x`);
  if (!at) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `记忆引擎要用的 ${provider} 没有钥匙` } }));
    return;
  }
  const key = at.key;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  let body: Buffer | undefined = chunks.length ? Buffer.concat(chunks) : undefined;
  // Ask OpenRouter to price it for us; without this a streamed completion reports tokens and no cost. Its own
  // extension, so only it is asked — another provider would reject the unknown field.
  if (body && provider === 'openrouter' && /chat\/completions|completions$/.test(path)) {
    try {
      const j = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
      j.usage = { include: true };
      body = Buffer.from(JSON.stringify(j));
    } catch {
      /* not JSON: forward as-is */
    }
  }
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  for (const [k, v] of Object.entries(req.headers)) {
    if (['authorization', 'host', 'connection', 'content-length'].includes(k) || typeof v !== 'string') continue;
    headers[k] = v;
  }
  let upstream: Response;
  try {
    upstream = await fetch(`${at.baseUrl}/${path}`, { method: req.method, headers, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(300_000) });
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: `记忆引擎的请求没发出去：${(e as Error).message}` } }));
    return;
  }
  const text = await upstream.text();
  const type = upstream.headers.get('content-type') ?? 'application/json';
  res.writeHead(upstream.status, { 'content-type': type });
  res.end(text);
  if (!upstream.ok) return;
  try {
    const kind = path.includes('embeddings') ? 'embed' : path.includes('rerank') ? 'rerank' : 'llm';
    const u = usageOf(text, type.includes('event-stream'));
    if (u) recordRaw('memory', undefined, u.model ?? `记忆·${kind}`, { input: u.input, output: u.output, cost: u.cost });
    else recordRaw('memory', undefined, `记忆·${kind}`, { units: 1 });
  } catch {
    /* accounting must never break the engine */
  }
}

/**
 * Start the forwarder and return its base, to which the caller appends the provider id of each leg. Undefined when
 * the listener will not come up — the caller then points the engine straight at the provider, unmetered but working.
 */
export async function startMeterProxy(): Promise<string | undefined> {
  if (base) return base;
  return new Promise((resolve) => {
    const s = createServer((req, res) => {
      void handle(req, res).catch((e: Error) => {
        console.warn('[crew] 记账代理出错：', e.message);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    s.on('error', (e) => {
      console.warn('[crew] 记账代理起不来，记忆引擎直连各家：', e.message);
      resolve(undefined);
    });
    s.listen(0, '127.0.0.1', () => {
      const addr = s.address();
      if (typeof addr === 'object' && addr) {
        server = s;
        base = `http://127.0.0.1:${addr.port}`;
        console.log(`[crew] 记忆引擎的模型调用走本机记账代理（${base}）`);
        resolve(base);
      } else resolve(undefined);
    });
  });
}

export function stopMeterProxy(): void {
  server?.close();
  server = undefined;
  base = undefined;
}
