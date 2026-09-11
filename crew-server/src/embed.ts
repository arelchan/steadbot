import { recordRaw } from './meter.ts';
/**
 * Embeddings, on the key everything else already uses.
 *
 * The pool is 230-odd manuals whose titles are English and whose one-liners are Chinese; a word-overlap search
 * over that (library.ts) finds「代码评审」when the user says 代码评审 and nothing when he says「帮我看看 PR 写得行不行」.
 * bge-m3 is what the memory engine indexes with (everos.ts), so meaning-level search costs no new credential and
 * no new model — one HTTP call, and the caller falls back to lexical whenever it fails.
 */
const MODEL = process.env.CREW_EMBEDDING_MODEL ?? 'baai/bge-m3';
const URL = 'https://openrouter.ai/api/v1/embeddings';
const BATCH = 64;

export const embedModel = () => MODEL;
export const canEmbed = () => !!process.env.OPENROUTER_API_KEY;

function normalize(v: number[]): Float32Array {
  const out = new Float32Array(v.length);
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i += 1) out[i] = v[i] / n;
  return out;
}

/** Unit vectors for each text, in order. Undefined — never a throw — when there is no key or the endpoint is unhappy. */
export async function embed(texts: string[], timeoutMs = 30_000): Promise<Float32Array[] | undefined> {
  if (!canEmbed() || !texts.length) return undefined;
  const out: Float32Array[] = [];
  try {
    for (let i = 0; i < texts.length; i += BATCH) {
      const input = texts.slice(i, i + BATCH).map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 2000) || '-');
      const r = await fetch(URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
        body: JSON.stringify({ model: MODEL, input }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 160)}`);
      const d = (await r.json()) as { data?: { index?: number; embedding?: number[] }[]; usage?: { prompt_tokens?: number; total_tokens?: number } };
      recordRaw('library', undefined, MODEL, { input: d.usage?.prompt_tokens ?? d.usage?.total_tokens, units: input.length });
      const rows = d.data ?? [];
      if (rows.length !== input.length) throw new Error(`asked for ${input.length} vectors, got ${rows.length}`);
      for (let j = 0; j < rows.length; j += 1) {
        const row = rows.find((x) => x.index === j) ?? rows[j];
        if (!row?.embedding?.length) throw new Error('a vector came back empty');
        out.push(normalize(row.embedding));
      }
    }
    return out;
  } catch (e) {
    console.warn('[crew] embeddings unavailable:', (e as Error).message);
    return undefined;
  }
}

export async function embedOne(text: string, timeoutMs = 10_000): Promise<Float32Array | undefined> {
  return (await embed([text], timeoutMs))?.[0];
}

export const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length && i < b.length; i += 1) s += a[i] * b[i];
  return s;
};

/** Float32 vectors survive a restart as base64 rather than 1024 JSON numbers apiece. */
export const packVec = (v: Float32Array) => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
export const unpackVec = (s: string) => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};
