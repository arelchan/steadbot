export const uid = () => Math.random().toString(36).slice(2, 10);

export const clean = (t: string) => t.replace(/[。！？!?，,、\s]+$/g, '').trim();

/** Turn a user's sentence into a short task title: drop politeness, keep the first clause. */
export function summarize(t: string): string {
  let c = clean(t).replace(/^(帮我|请|麻烦|你|能不能|可以)+/, '').replace(/^(帮我|请|麻烦)+/, '');
  const first = c.split(/[，,。；;]/)[0];
  if (first.length >= 6) c = first;
  c = c.replace(/(一下|下|吧|呗|哈|啊|呢|好吗|行吗)$/, '');
  return c.length > 22 ? c.slice(0, 22) + '…' : c;
}


/** Extract @mentions of known bots from text. */
export function parseMentions(text: string, bots: { id: string; name: string }[], exclude?: string): string[] {
  const out: string[] = [];
  for (const b of bots) {
    if (b.id === exclude) continue;
    if (text.includes('@' + b.name)) out.push(b.id);
  }
  return out;
}

/** The model's reasoning text, when the provider returns it. */
export function thinkingOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { type?: string; thinking?: string }) => (c && c.type === 'thinking' && typeof c.thinking === 'string' ? c.thinking : ''))
    .join('\n')
    .trim();
}

/** Does this assistant message call tools (i.e. the turn is not over)? */
export function hasToolCalls(content: unknown): boolean {
  return Array.isArray(content) && content.some((c: { type?: string }) => c && c.type === 'toolCall');
}

/** The tool calls inside an assistant message. What the bot reached for is most of what a case is made of (everos.ts). */
export function toolsOf(content: unknown): { name: string; args?: string }[] {
  if (!Array.isArray(content)) return [];
  return (content as { type?: string; name?: string; arguments?: unknown }[])
    .filter((c) => c && c.type === 'toolCall')
    .map((c) => ({ name: c.name ?? '', args: JSON.stringify(c.arguments ?? {}) }));
}

/**
 * When a reply landed entirely in the thinking channel, pull something showable out of it: the last
 * paragraph(s), capped, since the answer tends to sit at the end after the deliberation.
 */
export function salvageFromThinking(thinking: string): string {
  const t = thinking.replace(/\r/g, '').trim();
  if (!t) return '';
  if (t.length <= 400) return t;
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let out = '';
  for (let i = paras.length - 1; i >= 0; i--) {
    const next = out ? `${paras[i]}\n\n${out}` : paras[i];
    if (next.length > 600 && out) break;
    out = next;
    if (out.length >= 200) break;
  }
  return out.length > 700 ? `${out.slice(0, 700)}…` : out;
}

export function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: { type?: string; text?: string }) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
    .join('')
    .trim();
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

const SKIN = ['#f6d7bd', '#f1c9a5', '#e6b58f', '#d9a077', '#c68a63', '#fbe3cf'];
const HAIR = ['#2b2320', '#4a2f24', '#6b4a35', '#8a5a3c', '#3a3f6b', '#7a3b4a', '#2f4f3f', '#a8632e', '#555a63'];
const BG = ['#f6e9e1', '#e8eef5', '#e9f1e6', '#f4ecd9', '#f0e6f2', '#e5f0ee', '#f7e6e0', '#ebeaf5'];
const CHEEK = '#f0a3a0';

/** Deterministic cartoon face as an SVG data URI. Same algorithm as the frontend placeholder. */
export function proceduralAvatar(seed: string): string {
  const h = hash(seed);
  const pick = <T>(arr: T[], n: number) => arr[(h >>> n) % arr.length];
  const skin = pick(SKIN, 0);
  const hair = pick(HAIR, 4);
  const bg = pick(BG, 8);
  const style = (h >>> 12) % 5;
  const glasses = (h >>> 16) % 4 === 0;
  const eye = (h >>> 18) % 3;
  const mouth = (h >>> 20) % 3;
  const acc = (h >>> 22) % 5;
  const hairShape = [
    `<path d="M22 50c0-18 12-30 30-30s30 12 30 30v6c-6-8-14-12-30-12S28 48 22 56z" fill="${hair}"/>`,
    `<path d="M22 52c0-20 12-32 30-32 20 0 32 12 32 32-8-10-20-12-30-8-8 3-12 8-16 8-8 0-12-4-16 0z" fill="${hair}"/>`,
    `<circle cx="52" cy="20" r="11" fill="${hair}"/><path d="M22 52c0-18 12-30 30-30s30 12 30 30c-8-8-18-10-30-10S30 44 22 52z" fill="${hair}"/>`,
    `<path d="M20 78V52c0-18 12-30 32-30s32 12 32 30v26h-10V56c-6-6-14-8-22-8s-16 2-22 8v22z" fill="${hair}"/>`,
    `<path d="M22 54c-4-16 6-34 30-34s34 18 30 34c-4-8-10-10-14-8-4-6-10-8-16-8s-12 2-16 8c-4-2-10 0-14 8z" fill="${hair}"/>`,
  ][style];
  const eyes =
    eye === 1
      ? `<path d="M38 58q4-5 8 0M58 58q4-5 8 0" stroke="#2b2320" stroke-width="2.6" fill="none" stroke-linecap="round"/>`
      : eye === 2
        ? `<circle cx="42" cy="58" r="3.4" fill="#2b2320"/><circle cx="62" cy="58" r="3.4" fill="#2b2320"/><circle cx="43.2" cy="56.8" r="1" fill="#fff"/><circle cx="63.2" cy="56.8" r="1" fill="#fff"/>`
        : `<circle cx="42" cy="58" r="2.6" fill="#2b2320"/><circle cx="62" cy="58" r="2.6" fill="#2b2320"/>`;
  const mouthPath =
    mouth === 0
      ? `<path d="M46 70q6 5 12 0" stroke="#b0564a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
      : mouth === 1
        ? `<path d="M47 69q5 8 10 0z" fill="#b0564a"/>`
        : `<path d="M48 70h8" stroke="#b0564a" stroke-width="2.4" stroke-linecap="round"/>`;
  const accessory = [
    '',
    `<path d="M26 46q26-14 52 0" stroke="#c96f4a" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    `<circle cx="27" cy="66" r="2.5" fill="#d8a441"/><circle cx="77" cy="66" r="2.5" fill="#d8a441"/>`,
    `<path d="M64 26l10-6v14zM64 26l-10-6v14z" fill="#c96f4a"/><circle cx="64" cy="26" r="2.5" fill="#a8552f"/>`,
    `<path d="M22 48c0-16 12-28 30-28s30 12 30 28H22z" fill="#4a5d8a"/><path d="M18 48h70" stroke="#4a5d8a" stroke-width="5" stroke-linecap="round"/>`,
  ][acc];
  const specs = glasses
    ? `<circle cx="42" cy="58" r="8" stroke="#2b2320" stroke-width="1.8" fill="none"/><circle cx="62" cy="58" r="8" stroke="#2b2320" stroke-width="1.8" fill="none"/><path d="M50 58h4" stroke="#2b2320" stroke-width="1.8"/>`
    : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104"><circle cx="52" cy="52" r="52" fill="${bg}"/><path d="M30 104c2-16 10-24 22-24s20 8 22 24z" fill="${hair}" opacity="0.9"/><rect x="45" y="72" width="14" height="14" rx="5" fill="${skin}"/><circle cx="52" cy="58" r="26" fill="${skin}"/><circle cx="26" cy="60" r="4" fill="${skin}"/><circle cx="78" cy="60" r="4" fill="${skin}"/>${hairShape}<circle cx="36" cy="66" r="4" fill="${CHEEK}" opacity="0.55"/><circle cx="68" cy="66" r="4" fill="${CHEEK}" opacity="0.55"/>${eyes}${specs}${mouthPath}${accessory}</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, isAbsolute, join, normalize, relative, basename } from 'node:path';
import type { FileRef } from './types.ts';

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8', '.mmd': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8', '.mjs': 'text/plain; charset=utf-8', '.ts': 'text/plain; charset=utf-8', '.py': 'text/plain; charset=utf-8', '.sh': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8', '.xml': 'text/xml; charset=utf-8',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
};
export const mimeOf = (file: string) => MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';

/**
 * Files a reply refers to: absolute paths under the bot's directory, or workspace-relative paths that exist.
 * Returned as FileRefs the client renders as openable cards.
 */
/** Server-relative URL of a file under a bot's directory; clients prefix the runtime they are connected to. */
export const fileUrl = (botId: string, rel: string) => `/files/${botId}/${rel.split('/').map(encodeURIComponent).join('/')}`;

export function filesMentioned(text: string, botDir: string, publicUrl: string, botId: string): FileRef[] {
  const workspace = join(botDir, 'workspace');
  const out = new Map<string, FileRef>();
  /*
   * 同一条消息里提到的目录也算数：模型很爱把位置写在一行（「都在 …/dist/ 里」），文件名写在下面的
   * 表格或列表里。那种裸文件名相对工作区根目录是找不到的，于是一张卡都挂不上——先把消息里提到的
   * 目录收出来，解析文件名时挨个试。
   *
   * botDir 也是一个起点：模型一样爱写 `workspace/index.html` 这种相对 bot 目录的路径，只从 workspace
   * 起算的话它会落到 workspace/workspace/index.html 上，一样找不到。
   */
  const dirs = [workspace, botDir];
  for (const raw of text.match(/(?:\/|~\/|\.\/)[\w.\-\u4e00-\u9fff]+(?:\/[\w.\-\u4e00-\u9fff]+)*\/?/g) ?? []) {
    if (dirs.length > 6) break;
    const c = raw.replace(/^~\//, `${process.env.HOME ?? ''}/`);
    const abs = isAbsolute(c) ? normalize(c) : normalize(join(workspace, c.replace(/^\.\//, '')));
    try {
      if (statSync(abs).isDirectory() && !dirs.includes(abs)) dirs.push(abs);
    } catch {
      /* 不是目录就算了 */
    }
  }
  const candidates = text.match(/(?:\/|~\/|\.\/)?[\w.\-\u4e00-\u9fff]+(?:\/[\w.\-\u4e00-\u9fff]+)*\.[A-Za-z0-9]{1,6}\b/g) ?? [];
  for (const raw of candidates) {
    const c = raw.replace(/^~\//, `${process.env.HOME ?? ''}/`);
    if (/^(https?:|www\.)/.test(raw) || /\.(com|cn|org|net|io|ai|dev)$/i.test(raw)) continue;
    let abs = isAbsolute(c) ? normalize(c) : (dirs.map((d) => normalize(join(d, c.replace(/^\.\//, '')))).find((p) => existsSync(p)) ?? '');
    if (!abs || !existsSync(abs)) continue;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (!abs.startsWith(botDir + '/')) {
      // Scratch output (/tmp and friends) is pulled into the workspace so it can be served; anything else stays private.
      const scratch = [normalize(tmpdir()), '/tmp', '/private/tmp'].some((d) => abs.startsWith(d + '/'));
      if (!scratch) continue;
      try {
        const outDir = join(workspace, '_out');
        mkdirSync(outDir, { recursive: true });
        const dst = join(outDir, basename(abs));
        if (!existsSync(dst) || statSync(dst).mtimeMs < st.mtimeMs) copyFileSync(abs, dst);
        abs = dst;
        st = statSync(abs);
      } catch {
        continue;
      }
    }
    const rel = relative(botDir, abs);
    if (rel.startsWith('sessions/') || rel === 'MEMORY.md') continue;
    if (!out.has(rel)) out.set(rel, { name: basename(abs), path: rel, botId, size: st.size, mime: mimeOf(abs), url: fileUrl(botId, rel), mention: raw });
  }
  return [...out.values()].slice(0, 8);
}
