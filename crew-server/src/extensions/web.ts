import type { BotCtx } from './ctx.ts';
import { recordRaw } from '../meter.ts';
import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { config } from '../config.ts';

/**
 * Web access for every bot, no grant needed:
 *   web_search  OpenRouter's web plugin on the light model → a grounded answer + cited sources
 *   fetch_url   read one page as plain text
 */
interface Citation { url: string; title?: string; content?: string }

function searchModelId() {
  const spec = config.searchModel ?? config.lightModel ?? config.model ?? '';
  return spec.startsWith('openrouter/') ? spec.slice('openrouter/'.length) : spec;
}

export async function webSearch(query: string, signal?: AbortSignal, who?: string): Promise<{ answer: string; sources: Citation[] }> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('产品还没配置搜索能力（缺 OpenRouter 密钥）');
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: searchModelId(),
      plugins: [{ id: 'web', max_results: 6 }],
      messages: [
        { role: 'system', content: `现在是 ${new Date().toLocaleString('zh-CN', { hour12: false })}。根据搜索结果用中文简要回答，只写事实，带具体数字和日期；不确定就说不确定。不要 markdown。` },
        { role: 'user', content: query },
      ],
      max_tokens: 900,
      usage: { include: true },
    }),
  });
  if (!res.ok) throw new Error(`搜索服务返回 ${res.status}`);
  const j = (await res.json()) as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    choices?: { message?: { content?: string; annotations?: { type: string; url_citation?: Citation }[] } }[];
    error?: { message?: string };
  };
  // The web plugin is billed per result on top of the tokens, so the only number with both in it is usage.cost.
  recordRaw('search', who, j.model ?? searchModelId(), { input: j.usage?.prompt_tokens, output: j.usage?.completion_tokens, cost: j.usage?.cost, units: 1 });
  if (j.error) throw new Error(j.error.message ?? '搜索失败');
  const msg = j.choices?.[0]?.message;
  const seen = new Set<string>();
  const sources: Citation[] = [];
  for (const a of msg?.annotations ?? []) {
    const c = a.url_citation;
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
  if (!/^https?:\/\//i.test(url)) throw new Error('只支持 http(s) 链接');
  const res = await fetch(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; crew-bot/1.0)', Accept: 'text/html,application/json,text/plain,*/*' } });
  if (!res.ok) throw new Error(`页面返回 ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const body = await res.text();
  const text = /html/i.test(type) ? htmlToText(body) : body;
  return text.length > 8000 ? `${text.slice(0, 8000)}\n…（已截断，共 ${text.length} 字）` : text;
}

export function webExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-web',
    factory: (pi) => {
      pi.registerTool({
        name: 'web_search',
        label: '联网搜索',
        description:
          '联网搜索，直接返回一段基于搜索结果的答案，加来源列表（标题、链接、摘要）。用于：会变的信息（价格、汇率、天气、新闻、赛果、航班和火车状态、营业时间）；你不确定或可能过时的事实；外部产品、服务、文档、政策。不用于：用户自己的事（看记忆和对话）；常识问题；已经搜过、答案还在上下文里的内容。',
        promptSnippet: '联网搜索：实时信息、外部事实，返回答案 + 来源',
        promptGuidelines: [
          '凡是「今天 / 最新 / 现在多少」这类会变的信息，先 web_search 再答，不要凭记忆报数字。',
          '回复里提炼成一两句，带上来源链接（IM 里直接贴裸链接）；不要整段复述搜索结果。',
          '一次搜不到就换更具体的词（加地点、日期、机构名）再搜，最多三次；还不行就如实说没查到。',
        ],
        parameters: Type.Object({
          query: Type.String({ description: '搜索问题，一句完整的话，带上必要的地点、日期、名称' }),
        }),
        async execute(_id, p, signal) {
          const r = await webSearch(p.query, signal, c.botId);
          const src = r.sources.map((s, i) => `[${i + 1}] ${s.title ?? s.url}\n${s.url}${s.content ? `\n${s.content}` : ''}`).join('\n\n');
          return { content: [{ type: 'text', text: `${r.answer || '（没有综合出答案）'}\n\n来源：\n${src || '（无）'}` }], details: { query: p.query, sources: r.sources.map((s) => s.url) } };
        },
      });
      pi.registerTool({
        name: 'fetch_url',
        label: '打开网页',
        description:
          '打开一个链接，返回网页正文文字（已去掉 HTML，最多 8000 字）。用于：web_search 的某条来源需要看全文；用户发了链接让你看；要读一份在线文档或接口返回的 JSON。不用于：需要登录的页面、下载文件、提交表单。',
        promptSnippet: '打开链接读正文',
        promptGuidelines: ['用户发来的链接先 fetch_url 读完再回应，不要猜页面内容。'],
        parameters: Type.Object({ url: Type.String({ description: '完整的 http(s) 链接' }) }),
        async execute(_id, p, signal) {
          const text = await fetchUrl(p.url, signal);
          return { content: [{ type: 'text', text }], details: { url: p.url, chars: text.length } };
        },
      });
    },
  };
}
