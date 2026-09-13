import type { BotCtx } from './ctx.ts';
import { recordRaw } from '../meter.ts';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { endpointOf } from '../models.ts';

/**
 * Web access for every bot, no grant needed:
 *   web_search  a grounded answer + cited sources, from whichever vendor the web-search row is on
 *   fetch_url   read one page as plain text
 *
 * Every vendor here speaks OpenAI's chat/completions, so the request is the same one; what differs is the one
 * field that turns searching on and where the vendor puts what it read. That is the whole of `SEARCHERS` below —
 * anything else is not a search provider, it is a model answering from memory, which is worse than no answer.
 */
interface Citation { url: string; title?: string; content?: string }

type Raw = Record<string, unknown>;
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** How each vendor is asked to search, and where it lists what it read. */
const SEARCHERS: Record<string, { ask: Raw; read: (j: Raw, msg: Raw) => Citation[] }> = {
  // OpenRouter bolts its own `web` plugin onto any chat model and cites through message annotations.
  openrouter: {
    ask: { plugins: [{ id: 'web', max_results: 6 }], usage: { include: true } },
    read: (_j, msg) => arr(msg.annotations).map((a) => (a.url_citation ?? {}) as Citation),
  },
  // Perplexity's sonar models search by themselves; nothing to switch on.
  perplexity: {
    ask: {},
    read: (j) => [
      ...arr(j.search_results).map((r) => ({ url: str(r.url) ?? '', title: str(r.title), content: str(r.snippet) })),
      ...arr(j.citations).map((u) => ({ url: String(u) })),
    ],
  },
  // xAI's Live Search: one parameter, citations as bare URLs.
  xai: {
    ask: { search_parameters: { mode: 'auto', max_search_results: 6, return_citations: true } },
    read: (j) => arr(j.citations).map((u) => ({ url: String(u) })),
  },
  // Zhipu: search is a built-in tool rather than a flag, and the results come back beside the message.
  zhipu: {
    ask: { tools: [{ type: 'web_search', web_search: { enable: true, search_result: true } }] },
    read: (j) => arr(j.web_search).map((r) => ({ url: str(r.link) ?? str(r.url) ?? '', title: str(r.title), content: str(r.content) })),
  },
  // DashScope (Qwen): a flag plus a request for the sources, which arrive under search_info.
  dashscope: {
    ask: { enable_search: true, search_options: { forced_search: true, enable_source: true } },
    read: (j) => arr((j.search_info as Raw | undefined)?.search_results).map((r) => ({ url: str(r.url) ?? '', title: str(r.title), content: str(r.snippet) })),
  },
};

export const canSearchAt = (provider: string) => provider in SEARCHERS;

export async function webSearch(query: string, signal?: AbortSignal, who?: string): Promise<{ answer: string; sources: Citation[] }> {
  const at = endpointOf('searchModel');
  const how = at && SEARCHERS[at.provider];
  if (!at || !how) throw new Error('web search is not configured: pick a provider that can search under Settings › Models · Web search, and give it a key.');
  const res = await fetch(`${at.baseUrl}/chat/completions`, {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${at.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: at.model,
      ...how.ask,
      messages: [
        { role: 'system', content: `It is now ${new Date().toLocaleString('sv-SE', { hour12: false })}. Answer briefly from the search results in the language of the question: facts only, with concrete numbers and dates, and say so when something is uncertain. No markdown.` },
        { role: 'user', content: query },
      ],
      max_tokens: 900,
    }),
  });
  if (!res.ok) throw new Error(`the search service returned ${res.status}`);
  const j = (await res.json()) as Raw & {
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    choices?: { message?: { content?: string } }[];
    error?: { message?: string };
  };
  // OpenRouter's plugin is billed per result on top of the tokens, so the only number with both in it is usage.cost.
  recordRaw('search', who, str(j.model) ?? at.model, { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens, cost: j.usage?.cost, units: 1 });
  if (j.error) throw new Error(j.error.message ?? 'the search failed');
  const msg = (j.choices?.[0]?.message ?? {}) as Raw & { content?: string };
  const seen = new Set<string>();
  const sources: Citation[] = [];
  for (const c of how.read(j, msg)) {
    if (!c?.url || seen.has(c.url)) continue;
    seen.add(c.url);
    sources.push({ url: c.url, title: c.title, content: c.content?.replace(/\s+/g, ' ').slice(0, 240) });
  }
  return { answer: (msg?.content ?? '').trim(), sources };
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<(br|p|div|li|tr|h[1-6]|section|article|blockquote|pre)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchUrl(url: string, signal?: AbortSignal): Promise<string> {
  if (!/^https?:\/\//i.test(url)) throw new Error('http(s) links only');
  const res = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; crew-bot/1.0)', Accept: 'text/html,application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`the page returned ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const body = await res.text();
  const text = /html/i.test(type) ? htmlToText(body) : body;
  return text.length > 8000 ? `${text.slice(0, 8000)}\n… (truncated; ${text.length} characters in total)` : text;
}

export function webExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-web',
    factory: (pi) => {
      pi.registerTool({
        name: 'web_search',
        label: 'Web search',
        description:
          'Search the web and get an answer grounded in the results, plus the sources (title, link, summary). For: anything that changes (prices, rates, weather, news, results, flight and train status, opening hours); facts you are unsure of or that may be stale; external products, services, documentation and policies. Not for: the user\'s own affairs (memory and the thread have those); general knowledge; anything you already searched this turn.',
        promptSnippet: 'search the web for live information and outside facts; returns an answer plus sources',
        promptGuidelines: [
          'Anything of the "today / latest / how much now" kind gets a web_search before you answer. Never quote a number from memory.',
          'Boil it down to a sentence or two in your reply and include the source link (a bare URL is fine in a messenger). Do not recite the results.',
          'If the first search misses, try more specific words (a place, a date, an organisation), up to three times. After that, say plainly that you could not find it.',
        ],
        parameters: Type.Object({
          query: Type.String({ description: 'the question as a full sentence, with whatever place, date or name it needs' }),
        }),
        async execute(_id, p, signal) {
          const r = await webSearch(p.query, signal, c.botId);
          const src = r.sources.map((s, i) => `[${i + 1}] ${s.title ?? s.url}\n${s.url}${s.content ? `\n${s.content}` : ''}`).join('\n\n');
          return { content: [{ type: 'text', text: `${r.answer || '(no answer could be assembled)'}\n\nSources:\n${src || '(none)'}` }], details: { query: p.query, sources: r.sources.map((s) => s.url) } };
        },
      });
      pi.registerTool({
        name: 'fetch_url',
        label: 'Open a page',
        description:
          'Open a link and get the page text back (HTML stripped, up to 8000 characters). For: reading a search result in full, a link the user sent you, an online document or a JSON response. Not for: pages behind a login, downloading files, or submitting forms.',
        promptSnippet: 'open a link and read the text',
        promptGuidelines: ['Read a link the user sent with fetch_url before responding. Never guess what is on the page.'],
        parameters: Type.Object({ url: Type.String({ description: 'a complete http(s) link' }) }),
        async execute(_id, p, signal) {
          const text = await fetchUrl(p.url, signal);
          return { content: [{ type: 'text', text }], details: { url: p.url, chars: text.length } };
        },
      });
    },
  };
}
