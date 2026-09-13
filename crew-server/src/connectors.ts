import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { Type, type TSchema } from 'typebox';
import { Composio } from '@composio/core';
import { config } from './config.ts';
import type { CrewStore } from './store.ts';
import type { Integration, ThreadId } from './types.ts';

/**
 * Connectors: services the product knows how to connect end to end. The bot hands the user a card,
 * the user signs in once in the browser, the callback lands here, tokens go to disk, and the
 * connector's tools appear on the bot. No MCP process, no credentials in the chat.
 */
export interface ConnectorTool {
  name: string;
  description: string;
  schema: TSchema;
  /** direct Google API implementation (used when the product has its own Google OAuth client) */
  run: (call: (path: string, init?: RequestInit) => Promise<unknown>, args: Record<string, unknown>) => Promise<string>;
  /** Composio implementation: which Composio tool to call, how to map our args, how to render the result */
  composio: { slug: string; map: (args: Record<string, unknown>) => Record<string, unknown>; render: (data: Record<string, unknown>) => string };
}
export interface Connector {
  id: string;
  name: string;
  /** google = curated tools with a direct-API fallback; composio = any Composio toolkit, tools fetched from Composio */
  provider: 'google' | 'composio';
  /** Composio toolkit slug */
  toolkit: string;
  /** what the user sees on the card */
  blurb: string;
  scopes: string[];
  tools: ConnectorTool[];
}

const compact = (v: unknown, max = 6000) => {
  const s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
};
const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return String(o[k]);
  return '';
};
const arr = (d: Record<string, unknown>, keys: string[]): Record<string, unknown>[] => {
  for (const k of keys) if (Array.isArray(d[k])) return d[k] as Record<string, unknown>[];
  const inner = d.response_data ?? d.data;
  if (inner && typeof inner === 'object') for (const k of keys) if (Array.isArray((inner as Record<string, unknown>)[k])) return (inner as Record<string, unknown>)[k] as Record<string, unknown>[];
  return [];
};

interface Tokens { access_token: string; refresh_token?: string; expires_at: number; account?: string }
interface StartState { integrationId: string; botId: string; threadId: ThreadId; messageId?: string; connectorId: string; at: number }

const b64url = (s: string) => Buffer.from(s).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const stripHtml = (h: string) => h.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

interface GmailPart { mimeType?: string; body?: { data?: string }; parts?: GmailPart[] }
function gmailBody(p: GmailPart | undefined): string {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body?.data) return unb64url(p.body.data);
  if (p.parts) {
    const plain = p.parts.map(gmailBody).find(Boolean);
    if (plain) return plain;
  }
  if (p.mimeType === 'text/html' && p.body?.data) return stripHtml(unb64url(p.body.data));
  return '';
}
const header = (m: { payload?: { headers?: { name: string; value: string }[] } }, n: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === n.toLowerCase())?.value ?? '';

const GMAIL: Connector = {
  id: 'gmail',
  name: 'Gmail',
  provider: 'google',
  toolkit: 'gmail',
  blurb: 'read mail, search mail, send mail as you',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send'],
  tools: [
    {
      name: 'search_mail',
      description: 'Find mail with Gmail search syntax (from:boss@x.com newer_than:7d, subject:invoice has:attachment, is:unread) and get back sender, subject, date, snippet and id.',
      schema: Type.Object({ query: Type.String({ description: 'a Gmail search query' }), max: Type.Optional(Type.Number({ description: 'how many at most; defaults to 10, capped at 25' })) }),
      composio: {
        slug: 'GMAIL_FETCH_EMAILS',
        map: (a) => ({ query: String(a.query), max_results: Math.min(25, Math.max(1, Number(a.max ?? 10))), verbose: false, include_payload: false }),
        render: (d) => {
          const list = arr(d, ['messages']);
          if (!list.length) return 'No mail matched.';
          return list.map((m) => `- [${pick(m, ['messageId', 'id'])}] ${pick(m, ['messageTimestamp', 'date', 'internalDate'])} | ${pick(m, ['sender', 'from'])} | ${pick(m, ['subject']) || '(no subject)'}\n  ${(pick(m, ['preview', 'snippet', 'messageText']) || (typeof m.preview === 'object' && m.preview ? pick(m.preview as Record<string, unknown>, ['body', 'subject']) : '')).slice(0, 160)}`).join('\n');
        },
      },
      async run(call, a) {
        const max = Math.min(25, Math.max(1, Number(a.max ?? 10)));
        const list = (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(String(a.query))}&maxResults=${max}`)) as { messages?: { id: string }[] };
        if (!list.messages?.length) return 'No mail matched.';
        const rows = await Promise.all(
          list.messages.map(async ({ id }) => {
            const m = (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`)) as { id: string; snippet?: string; payload?: { headers?: { name: string; value: string }[] } };
            return `- [${m.id}] ${header(m, 'Date')} | ${header(m, 'From')} | ${header(m, 'Subject') || '(no subject)'}\n  ${(m.snippet ?? '').slice(0, 160)}`;
          }),
        );
        return rows.join('\n');
      },
    },
    {
      name: 'read_mail',
      description: 'Read the body of one message, by the id search_mail returned.',
      schema: Type.Object({ id: Type.String() }),
      composio: {
        slug: 'GMAIL_FETCH_MESSAGE_BY_MESSAGE_ID',
        map: (a) => ({ message_id: String(a.id), format: 'full' }),
        render: (d) => {
          const m = (d.response_data ?? d) as Record<string, unknown>;
          const body = pick(m, ['messageText', 'snippet']);
          return `From: ${pick(m, ['sender', 'from'])}\nTo: ${pick(m, ['to'])}\nDate: ${pick(m, ['messageTimestamp', 'date'])}\nSubject: ${pick(m, ['subject'])}\n\n${body ? (body.length > 12000 ? body.slice(0, 12000) + '\n… (truncated)' : body) : compact(m, 4000)}`;
        },
      },
      async run(call, a) {
        const m = (await call(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(String(a.id))}?format=full`)) as { payload?: GmailPart & { headers?: { name: string; value: string }[] } };
        const body = gmailBody(m.payload).trim();
        return `From: ${header(m, 'From')}\nTo: ${header(m, 'To')}\nDate: ${header(m, 'Date')}\nSubject: ${header(m, 'Subject')}\n\n${body.length > 12000 ? body.slice(0, 12000) + '\n… (truncated)' : body || '(empty body, or attachments only)'}`;
      },
    },
    {
      name: 'send_mail',
      description: 'Send a message as the user. This has consequences: it must already have been confirmed per the bot\'s autonomy before it is called.',
      schema: Type.Object({ to: Type.String({ description: 'the recipient; several separated by commas' }), subject: Type.String(), body: Type.String({ description: 'the body, as plain text' }), cc: Type.Optional(Type.String()) }),
      composio: {
        slug: 'GMAIL_SEND_EMAIL',
        map: (a) => {
          const to = String(a.to).split(/[,，;\s]+/).filter(Boolean);
          return { recipient_email: to[0], extra_recipients: to.slice(1), cc: a.cc ? String(a.cc).split(/[,，;\s]+/).filter(Boolean) : undefined, subject: String(a.subject), body: String(a.body), is_html: false };
        },
        render: (d) => `Sent (id ${pick((d.response_data ?? d) as Record<string, unknown>, ['id', 'messageId']) || '?'}).`,
      },
      async run(call, a) {
        const subj = `=?UTF-8?B?${Buffer.from(String(a.subject)).toString('base64')}?=`;
        const raw = [`To: ${a.to}`, a.cc ? `Cc: ${a.cc}` : '', `Subject: ${subj}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(String(a.body)).toString('base64')].filter((l) => l !== '').join('\r\n');
        const r = (await call('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', body: JSON.stringify({ raw: b64url(raw) }) })) as { id?: string };
        return `Sent (id ${r.id ?? '?'}).`;
      },
    },
  ],
};

const CALENDAR: Connector = {
  id: 'google-calendar',
  name: 'Google Calendar',
  provider: 'google',
  toolkit: 'googlecalendar',
  blurb: 'see the schedule, find free time, create and change meetings for you',
  scopes: ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events'],
  tools: [
    {
      name: 'list_events',
      description: 'List events in a window, from the primary calendar. Times are ISO 8601, like 2026-09-07T00:00:00+08:00; without them it defaults to the next seven days.',
      schema: Type.Object({ from: Type.Optional(Type.String()), to: Type.Optional(Type.String()) }),
      composio: {
        slug: 'GOOGLECALENDAR_EVENTS_LIST',
        map: (a) => {
          const from = a.from ? new Date(String(a.from)) : new Date();
          const to = a.to ? new Date(String(a.to)) : new Date(from.getTime() + 7 * 86400000);
          return { calendarId: 'primary', timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: true, orderBy: 'startTime', maxResults: 50 };
        },
        render: (d) => {
          const items = arr(d, ['items', 'events']);
          if (!items.length) return 'Nothing in that window.';
          const t = (v: unknown) => (v && typeof v === 'object' ? pick(v as Record<string, unknown>, ['dateTime', 'date']) : String(v ?? ''));
          return items.map((e) => `- [${pick(e, ['id'])}] ${t(e.start)} → ${t(e.end)} | ${pick(e, ['summary']) || '(untitled)'}${e.location ? ` @ ${e.location}` : ''}${Array.isArray(e.attendees) && e.attendees.length ? ` | ${(e.attendees as { email: string }[]).map((x) => x.email).join(', ')}` : ''}`).join('\n');
        },
      },
      async run(call, a) {
        const from = a.from ? new Date(String(a.from)) : new Date();
        const to = a.to ? new Date(String(a.to)) : new Date(from.getTime() + 7 * 86400000);
        const r = (await call(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=50&timeMin=${encodeURIComponent(from.toISOString())}&timeMax=${encodeURIComponent(to.toISOString())}`)) as { items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string; attendees?: { email: string }[] }[] };
        if (!r.items?.length) return 'Nothing in that window.';
        return r.items.map((e) => `- [${e.id}] ${e.start?.dateTime ?? e.start?.date} → ${e.end?.dateTime ?? e.end?.date} | ${e.summary ?? '(untitled)'}${e.location ? ` @ ${e.location}` : ''}${e.attendees?.length ? ` | ${e.attendees.map((x) => x.email).join(', ')}` : ''}`).join('\n');
      },
    },
    {
      name: 'create_event',
      description: 'Create an event on the primary calendar. This has consequences — it takes the user\'s time and invites other people — so confirm per the bot\'s autonomy first.',
      schema: Type.Object({ title: Type.String(), start: Type.String({ description: 'ISO 8601 with a timezone' }), end: Type.String({ description: 'ISO 8601 with a timezone' }), attendees: Type.Optional(Type.Array(Type.String({ description: 'an email address' }))), location: Type.Optional(Type.String()), description: Type.Optional(Type.String()) }),
      composio: {
        slug: 'GOOGLECALENDAR_CREATE_EVENT',
        map: (a) => {
          const mins = Math.max(15, Math.round((new Date(String(a.end)).getTime() - new Date(String(a.start)).getTime()) / 60000));
          return { summary: String(a.title), start_datetime: String(a.start), event_duration_hour: Math.floor(mins / 60), event_duration_minutes: mins % 60, attendees: Array.isArray(a.attendees) ? a.attendees : undefined, location: a.location, description: a.description, calendar_id: 'primary', send_updates: true };
        },
        render: (d) => {
          const r = (d.response_data ?? d) as Record<string, unknown>;
          return `Created (id ${pick(r, ['id']) || '?'})${r.htmlLink ? `: ${r.htmlLink}` : ''}`;
        },
      },
      async run(call, a) {
        const r = (await call('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all', {
          method: 'POST',
          body: JSON.stringify({ summary: a.title, start: { dateTime: a.start }, end: { dateTime: a.end }, location: a.location, description: a.description, attendees: Array.isArray(a.attendees) ? (a.attendees as string[]).map((email) => ({ email })) : undefined }),
        })) as { id?: string; htmlLink?: string };
        return `Created (id ${r.id ?? '?'})${r.htmlLink ? `: ${r.htmlLink}` : ''}`;
      },
    },
    {
      name: 'delete_event',
      description: 'Delete an event, by the id list_events returned. Irreversible: confirm first.',
      schema: Type.Object({ id: Type.String() }),
      composio: { slug: 'GOOGLECALENDAR_DELETE_EVENT', map: (a) => ({ event_id: String(a.id), calendar_id: 'primary' }), render: () => 'Deleted.' },
      async run(call, a) {
        await call(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(String(a.id))}?sendUpdates=all`, { method: 'DELETE' });
        return 'Deleted.';
      },
    },
  ],
};

export const CONNECTORS: Connector[] = [GMAIL, CALENDAR];
export const connectorById = (id: string) => CONNECTORS.find((c) => c.id === id || c.name === id);
/**
 * Platforms behind the product's OAuth connector service. Each is an MCP-style tool set the bot gets after the user
 * clicks a login card; in the pool they read as external tools whose authorization is a click, not a key.
 */
export const TOOLKITS: { slug: string; title: string; description: string; tags: string[]; category: string }[] = [
  { slug: 'gmail', title: 'Gmail', description: 'Read mail, search mail, send and reply as the user.', tags: ['email', 'mail', 'gmail', 'inbox', '邮件', '邮箱', '收件箱', '发邮件'], category: 'productivity' },
  { slug: 'googlecalendar', title: 'Google Calendar', description: 'See the schedule, find free time, create and change meetings, send invitations.', tags: ['calendar', 'schedule', 'meeting', 'invite', '日历', '日程', '会议'], category: 'productivity' },
  { slug: 'googledrive', title: 'Google Drive', description: 'Find, read, upload and share files in Drive.', tags: ['drive', 'files', 'cloud storage', 'share', 'upload', '云盘', '文件'], category: 'productivity' },
  { slug: 'googlesheets', title: 'Google Sheets', description: 'Read and write spreadsheets: query rows, append, edit cells, create sheets.', tags: ['sheets', 'spreadsheet', 'data', '表格', '电子表格'], category: 'productivity' },
  { slug: 'googledocs', title: 'Google Docs', description: 'Read and write documents, create new ones, append paragraphs.', tags: ['docs', 'document', 'writing', '文档', '在线文档'], category: 'productivity' },
  { slug: 'notion', title: 'Notion', description: 'Read pages and databases, create pages, append blocks, query records.', tags: ['notion', 'notes', 'wiki', 'database', 'pages', '笔记', '知识库'], category: 'productivity' },
  { slug: 'slack', title: 'Slack (read and write a workspace)', description: 'Search messages, read channels, post to a channel or a DM. This reads and writes the user\'s Slack; it is not how you appear in Slack as a bot yourself.', tags: ['slack', 'channel', 'messages', 'workspace', '频道', '消息'], category: 'productivity' },
  { slug: 'github', title: 'GitHub', description: 'Read repositories, code and commits, find PRs and issues, and also open issues, raise PRs, review and merge.', tags: ['github', 'git', 'code', 'repository', 'PR', 'issue', '代码', '仓库'], category: 'dev' },
  { slug: 'linear', title: 'Linear', description: 'Find, create and change issues and projects in Linear.', tags: ['linear', 'issue', 'tasks', 'project management', '任务', '项目管理'], category: 'dev' },
  { slug: 'jira', title: 'Jira', description: 'Find, create and change tickets and boards in Jira.', tags: ['jira', 'ticket', 'issue', 'board', 'project management', '工单', '看板'], category: 'dev' },
  { slug: 'trello', title: 'Trello', description: 'Read and write boards, cards and lists.', tags: ['trello', 'board', 'cards', 'tasks', '看板', '卡片'], category: 'productivity' },
  { slug: 'asana', title: 'Asana', description: 'Read and write tasks, projects, assignees and due dates.', tags: ['asana', 'tasks', 'project management', 'due dates', '任务', '项目管理'], category: 'productivity' },
  { slug: 'outlook', title: 'Outlook', description: "Microsoft mail and calendar: read mail, send mail, see the schedule.", tags: ['outlook', 'mail', 'email', 'calendar', 'microsoft', 'office', '邮件', '日历'], category: 'productivity' },
  { slug: 'dropbox', title: 'Dropbox', description: 'Find, read, upload and share files in Dropbox.', tags: ['dropbox', 'files', 'cloud storage', 'share', '云盘', '文件'], category: 'productivity' },
  { slug: 'airtable', title: 'Airtable', description: 'Read and write Airtable tables and records.', tags: ['airtable', 'tables', 'database', 'records', '表格', '数据库'], category: 'productivity' },
  { slug: 'hubspot', title: 'HubSpot', description: 'CRM reads and writes: contacts, companies, deals.', tags: ['hubspot', 'crm', 'customers', 'sales', 'contacts', 'leads', '客户', '销售'], category: 'business' },
  { slug: 'discord', title: 'Discord', description: 'Read channels, post messages, manage what is on a server.', tags: ['discord', 'channel', 'community', 'messages', '频道', '社群'], category: 'productivity' },
  { slug: 'lark', title: 'Lark (Feishu international)', description: "Documents, calendar and messages on Lark. Mainland Feishu does not go through here.", tags: ['lark', 'documents', 'calendar', '文档', '日历'], category: 'productivity' },
  { slug: 'twitter', title: 'X (Twitter)', description: 'Search posts, read the timeline, post and reply.', tags: ['twitter', 'x', 'posts', 'social', '推特', '推文'], category: 'business' },
  { slug: 'youtube', title: 'YouTube', description: 'Search videos, read channel and video information, fetch captions.', tags: ['youtube', 'video', 'channel', 'captions', '视频', '字幕'], category: 'research' },
];
/** Common Composio toolkit slugs, for the tool description and for guessing what the user meant. */
export const POPULAR_TOOLKITS = TOOLKITS.map((t) => t.slug);

interface DynTool { slug: string; name: string; description: string; schema: TSchema; write: boolean }
/** Read-only operations by slug verb; everything else changes state on the user's account. */
const isWriteSlug = (slug: string, prefix: string) => !/^(GET|LIST|SEARCH|FIND|COMPARE|CHECK|FETCH|READ|RETRIEVE|DOWNLOAD|COUNT|QUERY|DESCRIBE|LOOKUP|SHOW|VIEW)(_|$)/.test(slug.startsWith(prefix) ? slug.slice(prefix.length) : slug);
/**
 * Tools a bot must have before anything else, per toolkit: the read side first (Composio's "important" set for GitHub is
 * almost all writes, which is how a bot ended up probing access by committing files), then the everyday writes.
 */
const PREFERRED_TOOLS: Record<string, string[]> = {
  github: [
    'GITHUB_GET_A_REPOSITORY', 'GITHUB_GET_A_TREE', 'GITHUB_GET_REPOSITORY_CONTENT', 'GITHUB_GET_RAW_REPOSITORY_CONTENT', 'GITHUB_GET_A_REPOSITORY_README',
    'GITHUB_SEARCH_CODE', 'GITHUB_LIST_COMMITS', 'GITHUB_GET_A_COMMIT', 'GITHUB_COMPARE_TWO_COMMITS', 'GITHUB_LIST_BRANCHES',
    'GITHUB_FIND_PULL_REQUESTS', 'GITHUB_GET_A_PULL_REQUEST', 'GITHUB_LIST_PULL_REQUESTS_FILES', 'GITHUB_LIST_REPOSITORY_ISSUES', 'GITHUB_GET_AN_ISSUE',
    'GITHUB_LIST_REPOSITORIES_FOR_THE_AUTHENTICATED_USER',
    'GITHUB_CREATE_AN_ISSUE', 'GITHUB_CREATE_AN_ISSUE_COMMENT', 'GITHUB_CREATE_BRANCH', 'GITHUB_CREATE_OR_UPDATE_FILE_CONTENTS', 'GITHUB_COMMIT_MULTIPLE_FILES',
    'GITHUB_CREATE_A_PULL_REQUEST', 'GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST', 'GITHUB_MERGE_A_PULL_REQUEST',
  ],
};
const normSlug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
/** Names people actually type → Composio slugs. Chinese platforms are not on Composio; they map to nothing on purpose. */
const ALIASES: Record<string, string> = {
  google日历: 'googlecalendar', googlecal: 'googlecalendar', calendar: 'googlecalendar', 日历: 'googlecalendar',
  邮箱: 'gmail', 邮件: 'gmail', mail: 'gmail', email: 'gmail', gmail邮箱: 'gmail',
  drive: 'googledrive', gdrive: 'googledrive', sheets: 'googlesheets', docs: 'googledocs',
  teams: 'microsoft_teams', microsoftteams: 'microsoft_teams', msteams: 'microsoft_teams',
  outlookmail: 'outlook', outlook邮箱: 'outlook', x: 'twitter',
};
const CN_UNSUPPORTED = /飞书|feishu|lark|钉钉|dingtalk|微信|wechat|wecom|企业微信|腾讯|qq/i;
export const isChinesePlatform = (s: string) => CN_UNSUPPORTED.test(s);

/** Single-tenant product: every connection belongs to the one owner. */
const OWNER = 'owner';

export class ConnectorManager extends EventEmitter {
  private states = new Map<string, StartState>();
  private tokens = new Map<string, Tokens>();
  private composio = config.composio ? new Composio({ apiKey: config.composio.apiKey }) : undefined;
  private authConfigIds = new Map<string, string>();

  constructor(private store: CrewStore) {
    super();
    mkdirSync(config.connectionsDir, { recursive: true });
  }

  private dynamic = new Map<string, Connector>();
  private dynTools = new Map<string, DynTool[]>();

  /**
   * Resolve what the bot asked for: a curated connector, or any Composio toolkit by slug (notion, slack,
   * github, lark…). Returns undefined when Composio doesn't know it either.
   */
  async resolve(service: string): Promise<Connector | undefined> {
    const key = service.trim().toLowerCase().replace(/\s+/g, '');
    const aliased = ALIASES[key] ?? ALIASES[normSlug(service)];
    const curated = connectorById(service) ?? connectorById(normSlug(service)) ?? CONNECTORS.find((c) => normSlug(c.toolkit) === normSlug(aliased ?? service));
    if (curated) return curated;
    if (!this.composio) return undefined;
    const slug = aliased ?? normSlug(service);
    if (!slug) return undefined;
    const cached = this.dynamic.get(slug);
    if (cached) return cached;
    try {
      const tk = await this.composio.toolkits.get(slug);
      const meta = (tk.meta ?? {}) as { description?: string };
      const c: Connector = { id: slug, name: tk.name || slug, provider: 'composio', toolkit: slug, blurb: (meta.description ?? '').split(/[.。]/)[0].slice(0, 60) || `接入 ${tk.name || slug}`, scopes: [], tools: [] };
      this.dynamic.set(slug, c);
      return c;
    } catch {
      return undefined;
    }
  }

  /** Composio's own tool list for a toolkit (the "important" ones), with their schemas, cached per process. */
  private async dynToolsFor(toolkit: string): Promise<DynTool[]> {
    const cached = this.dynTools.get(toolkit);
    if (cached) return cached;
    if (!this.composio) return [];
    const preferred = PREFERRED_TOOLS[toolkit] ?? [];
    type Raw = Awaited<ReturnType<typeof this.composio.tools.getRawComposioTools>>;
    let head: Raw = [];
    if (preferred.length) {
      head = await this.composio.tools.getRawComposioTools({ tools: preferred }).catch(() => [] as Raw);
      head.sort((a, b) => preferred.indexOf(a.slug) - preferred.indexOf(b.slug));
    }
    let list = await this.composio.tools.getRawComposioTools({ toolkits: [toolkit], important: true, limit: 25 });
    if (!list.length) list = await this.composio.tools.getRawComposioTools({ toolkits: [toolkit], limit: 25 });
    const seen = new Set<string>();
    const merged = [...head, ...list].filter((t) => (seen.has(t.slug) ? false : (seen.add(t.slug), true))).slice(0, 40);
    const prefix = `${toolkit.toUpperCase()}_`;
    // Reads first so the model sees the harmless way to answer before any way that changes data.
    const tools: DynTool[] = merged
      .map((t) => ({
        slug: t.slug,
        name: (t.slug.startsWith(prefix) ? t.slug.slice(prefix.length) : t.slug).toLowerCase(),
        description: (t.description ?? t.name ?? t.slug).slice(0, 400),
        schema: (t.inputParameters && typeof t.inputParameters === 'object' ? (t.inputParameters as unknown as TSchema) : Type.Object({}, { additionalProperties: true })),
        write: isWriteSlug(t.slug, prefix),
      }))
      .sort((a, b) => Number(a.write) - Number(b.write));
    this.dynTools.set(toolkit, tools);
    return tools;
  }

  /** Tool list to publish on the integration record. */
  private async toolsFor(c: Connector) {
    if (c.provider === 'google') return c.tools.map((t) => ({ name: t.name, description: t.description, write: /^(send|create|delete|update|move|archive)/.test(t.name) }));
    return (await this.dynToolsFor(c.toolkit)).map((t) => ({ name: t.name, description: t.description, write: t.write }));
  }

  /** Which backend does the sign-in and the API calls: Composio's managed OAuth apps, or our own Google client. */
  backend(): 'composio' | 'google' | undefined {
    return this.composio ? 'composio' : config.google ? 'google' : undefined;
  }

  /** Is this connector usable at the product level? */
  available(c: Connector) {
    return c.provider === 'google' ? !!this.backend() : !!this.composio;
  }

  /** Composio auth config for a toolkit: reuse an existing managed one, else create it. */
  private async authConfigFor(c: Connector): Promise<string> {
    const cached = this.authConfigIds.get(c.toolkit);
    if (cached) return cached;
    const list = await this.composio!.authConfigs.list({ toolkit: c.toolkit, isComposioManaged: true, limit: 10 });
    let id = list.items.find((x) => x.toolkit.slug.toLowerCase() === c.toolkit)?.id;
    if (!id) id = (await this.composio!.authConfigs.create(c.toolkit, { type: 'use_composio_managed_auth', name: `crew ${c.name}` })).id;
    this.authConfigIds.set(c.toolkit, id);
    return id;
  }

  /** Composio: the hosted sign-in link; completion is detected by polling the connection request. */
  async startUrlComposio(c: Connector, ctx: { botId: string; threadId: ThreadId; messageId?: string }) {
    const integ = this.integrationFor(c);
    const state = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const authConfigId = await this.authConfigFor(c);
    // A fresh link is only for a fresh sign-in: clear what Composio still holds (expired / revoked / duplicates).
    await this.dropComposioAccounts(c);
    const req = await this.composio!.connectedAccounts.link(OWNER, authConfigId, { callbackUrl: `${config.publicUrl}/oauth/composio/callback?state=${state}` });
    if (!req.redirectUrl) throw new Error('Composio 没有返回登录链接');
    this.states.set(state, { integrationId: integ.id, botId: ctx.botId, threadId: ctx.threadId, messageId: ctx.messageId, connectorId: c.id, at: Date.now() });
    console.log(`[crew] connect card ${c.id} state=${state}`);
    void this.awaitComposio(req.id, state, c);
    return { url: req.redirectUrl, integration: integ };
  }

  /** Report a failed or expired authorization for a pending state (idempotent). */
  fail(state: string, reason: string, kind: 'failed' | 'expired' = 'failed') {
    const st = this.states.get(state);
    if (!st) return false;
    this.states.delete(state);
    const c = connectorById(st.connectorId) ?? this.dynamic.get(st.connectorId);
    const integration = this.store.patchIntegration(st.integrationId, { status: 'error', note: kind === 'expired' ? '授权卡已过期，让 bot 重新发一张' : `授权没有完成：${reason.slice(0, 120)}` });
    this.emit('failed', { integration, state: st, reason, kind, name: c?.name ?? st.connectorId });
    return true;
  }

  private async awaitComposio(connectedAccountId: string, state: string, c: Connector) {
    try {
      const acct = await this.composio!.connectedAccounts.waitForConnection(connectedAccountId, 15 * 60 * 1000);
      const st = this.states.get(state);
      if (!st) return;
      if (acct.status !== 'ACTIVE') {
        this.fail(state, `连接状态 ${acct.status}${acct.statusReason ? `：${acct.statusReason}` : ''}`);
        return;
      }
      this.states.delete(state);
      let account: string | undefined;
      if (c.toolkit === 'gmail') {
        try {
          const r = await this.composio!.tools.execute('GMAIL_GET_PROFILE', { userId: OWNER, arguments: {}, dangerouslySkipVersionCheck: true });
          account = pick((r.data.response_data ?? r.data) as Record<string, unknown>, ['emailAddress', 'email']) || undefined;
        } catch {
          /* cosmetic */
        }
      }
      const integration = this.store.patchIntegration(st.integrationId, { status: 'ok', account, note: account ? `已连接 ${account}` : '已连接', tools: await this.toolsFor(c) })!;
      this.emit('connected', { integration, state: st });
    } catch (e) {
      const msg = (e as Error).message;
      const timeout = /timed? ?out|timeout/i.test((e as Error).name + ' ' + msg);
      this.fail(state, msg, timeout ? 'expired' : 'failed');
    }
  }

  /** Composio: is there an ACTIVE connection for this toolkit? */
  private async composioActive(c: Connector) {
    const r = await this.composio!.connectedAccounts.list({ userIds: [OWNER], toolkitSlugs: [c.toolkit], statuses: ['ACTIVE'] });
    return r.items.length > 0;
  }

  /**
   * Before handing out a new sign-in link: if Composio already holds an ACTIVE account for this
   * toolkit (e.g. the connection was removed locally, or the bot asked twice), adopt it instead of
   * asking the user to sign in again. Returns the integration when adopted.
   */
  async reconcile(c: Connector): Promise<Integration | undefined> {
    if (this.backend() !== 'composio') return undefined;
    try {
      if (!(await this.composioActive(c))) return undefined;
      const integ = this.integrationFor(c);
      if (integ.status === 'ok' && integ.tools?.length) return integ;
      return this.markConnected(c, integ.id);
    } catch (e) {
      console.warn('[crew] reconcile failed:', (e as Error).message);
      return undefined;
    }
  }

  /** Publish a working Composio connection on the integration record: status, account, tool list. */
  private async markConnected(c: Connector, integrationId: string) {
    let account: string | undefined;
    if (c.toolkit === 'gmail') {
      try {
        const r = await this.composio!.tools.execute('GMAIL_GET_PROFILE', { userId: OWNER, arguments: {}, dangerouslySkipVersionCheck: true });
        account = pick((r.data.response_data ?? r.data) as Record<string, unknown>, ['emailAddress', 'email']) || undefined;
      } catch {
        /* cosmetic */
      }
    }
    return this.store.patchIntegration(integrationId, { status: 'ok', account, note: account ? `已连接 ${account}` : '已连接', tools: await this.toolsFor(c) });
  }

  /** Drop Composio's stale accounts for a toolkit so a fresh sign-in link can be issued. */
  private async dropComposioAccounts(c: Connector) {
    const r = await this.composio!.connectedAccounts.list({ userIds: [OWNER], toolkitSlugs: [c.toolkit] });
    for (const a of r.items) await this.composio!.connectedAccounts.delete(a.id).catch(() => undefined);
  }

  /** The integration record for a connector, creating it (status connecting) when missing. */
  integrationFor(c: Connector): Integration {
    const existing = this.store.data.integrations.find((i) => i.connector === c.id);
    if (existing) return existing;
    return this.store.addIntegration({ id: `cn-${c.id}`, kind: 'mcp', connector: c.id, name: c.name, status: 'connecting', note: '等待用户授权', tools: c.provider === 'google' ? c.tools.map((t) => ({ name: t.name, description: t.description })) : [] });
  }

  /** URL for the card button; the state remembers which bot/thread to wake when the user is back. */
  async startUrl(c: Connector, ctx: { botId: string; threadId: ThreadId; messageId?: string }) {
    if (this.backend() === 'composio') return this.startUrlComposio(c, ctx);
    const integ = this.integrationFor(c);
    const state = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    this.states.set(state, { integrationId: integ.id, botId: ctx.botId, threadId: ctx.threadId, messageId: ctx.messageId, connectorId: c.id, at: Date.now() });
    return { url: `${config.publicUrl}/oauth/google/start?state=${state}`, integration: integ };
  }

  /** GET /oauth/google/start → Google's consent page. */
  authRedirect(state: string): string | undefined {
    const st = this.states.get(state);
    const c = st && connectorById(st.connectorId);
    if (!st || !c || !config.google) return undefined;
    const q = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: `${config.publicUrl}/oauth/google/callback`,
      response_type: 'code',
      scope: c.scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }

  /** GET /oauth/google/callback → exchange the code, store tokens, publish the integration, wake the bot. */
  async handleCallback(code: string, state: string): Promise<{ integration: Integration; state: StartState }> {
    const st = this.states.get(state);
    if (!st || Date.now() - st.at > 30 * 60 * 1000) throw new Error('授权链接已过期，请让 bot 重新发一张卡片');
    if (!config.google) throw new Error('产品未配置 Google 接入');
    this.states.delete(state);
    const body = new URLSearchParams({ code, client_id: config.google.clientId, client_secret: config.google.clientSecret, redirect_uri: `${config.publicUrl}/oauth/google/callback`, grant_type: 'authorization_code' });
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `token exchange failed (${res.status})`);
    const tok: Tokens = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 };
    try {
      const u = (await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json()) as { email?: string };
      tok.account = u.email;
    } catch {
      /* account is cosmetic */
    }
    this.saveTokens(st.integrationId, tok);
    const c = connectorById(st.connectorId)!;
    const integration = this.store.patchIntegration(st.integrationId, { status: 'ok', account: tok.account, note: tok.account ? `已连接 ${tok.account}` : '已连接', tools: c.tools.map((t) => ({ name: t.name, description: t.description })) })!;
    this.emit('connected', { integration, state: st });
    return { integration, state: st };
  }

  /** Re-check a stored connection (used by the 重连 button). */
  async verify(integrationId: string) {
    const c = await this.connectorOfAsync(integrationId);
    if (this.backend() === 'composio' && c) {
      try {
        const ok = await this.composioActive(c);
        if (ok) await this.markConnected(c, integrationId);
        else this.store.patchIntegration(integrationId, { status: 'error', note: '授权失效或已撤销，让 bot 重新发一张授权卡' });
      } catch (e) {
        this.store.patchIntegration(integrationId, { status: 'error', note: `无法检查：${(e as Error).message.slice(0, 120)}` });
      }
      return;
    }
    try {
      const token = await this.accessToken(integrationId);
      const u = (await (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } })).json()) as { email?: string };
      this.store.patchIntegration(integrationId, { status: 'ok', account: u.email, note: u.email ? `已连接 ${u.email}` : '已连接' });
    } catch (e) {
      this.store.patchIntegration(integrationId, { status: 'error', note: `授权失效：${(e as Error).message.slice(0, 120)}，让 bot 重新发一张授权卡` });
    }
  }

  /** Removing a connection revokes it everywhere: local tokens, and Composio's stored accounts for the toolkit. */
  async disconnect(integrationId: string) {
    this.tokens.delete(integrationId);
    rmSync(this.tokenFile(integrationId), { force: true });
    const c = await this.connectorOfAsync(integrationId).catch(() => undefined);
    if (c && this.composio) await this.dropComposioAccounts(c).catch((e) => console.warn('[crew] composio account cleanup failed:', (e as Error).message));
  }

  async toolSchema(integrationId: string, name: string): Promise<TSchema | undefined> {
    const c = await this.connectorOfAsync(integrationId);
    if (!c) return undefined;
    if (c.provider === 'google') return c.tools.find((t) => t.name === name)?.schema;
    return (await this.dynToolsFor(c.toolkit)).find((t) => t.name === name)?.schema;
  }

  /** Does this integration sit on a Composio toolkit (and so has a long tail of tools beyond the published list)? */
  async hasToolkit(integrationId: string) {
    const c = await this.connectorOfAsync(integrationId).catch(() => undefined);
    return !!(c && c.provider === 'composio' && this.composio);
  }

  /** Search the toolkit's full tool catalog (thousands for GitHub); returns slug, purpose, parameters and the write flag. */
  async searchTools(integrationId: string, query: string, limit = 8) {
    const c = await this.connectorOfAsync(integrationId);
    if (!c || c.provider !== 'composio' || !this.composio) throw new Error('这个连接没有可搜索的工具目录');
    const list = await this.composio.tools.getRawComposioTools({ toolkits: [c.toolkit], search: query, limit });
    const prefix = `${c.toolkit.toUpperCase()}_`;
    return list.map((t) => {
      const props = (t.inputParameters as { properties?: Record<string, { description?: string }>; required?: string[] } | undefined) ?? {};
      const required = new Set(props.required ?? []);
      return {
        slug: t.slug,
        write: isWriteSlug(t.slug, prefix),
        description: (t.description ?? t.name ?? t.slug).slice(0, 300),
        params: Object.entries(props.properties ?? {}).map(([k, v]) => `${k}${required.has(k) ? '*' : ''}${v?.description ? `（${v.description.slice(0, 60)}）` : ''}`),
      };
    });
  }

  /** Execute any tool of the toolkit by its Composio slug (for the long tail found via searchTools). */
  async callToolBySlug(integrationId: string, slug: string, args: Record<string, unknown>): Promise<string> {
    const c = await this.connectorOfAsync(integrationId);
    if (!c || c.provider !== 'composio' || !this.composio) throw new Error('这个连接不支持按 slug 调用');
    const prefix = `${c.toolkit.toUpperCase()}_`;
    const s = slug.trim().toUpperCase();
    if (!s.startsWith(prefix)) throw new Error(`slug 必须是 ${c.name} 的工具（以 ${prefix} 开头）`);
    return this.execComposio(c, integrationId, s, args);
  }

  private async execComposio(c: Connector, integrationId: string, slug: string, args: Record<string, unknown>) {
    const r = await this.composio!.tools.execute(slug, { userId: OWNER, arguments: args, dangerouslySkipVersionCheck: true });
    if (!r.successful) {
      if (/not connected|no connected account|expired|revoked|401/i.test(r.error ?? '')) this.store.patchIntegration(integrationId, { status: 'error', note: '授权失效，让 bot 重新发一张授权卡' });
      throw new Error(`${c.name} 返回错误：${(r.error ?? '未知错误').slice(0, 300)}`);
    }
    return compact(r.data, 20000);
  }

  async callTool(integrationId: string, name: string, args: Record<string, unknown>): Promise<string> {
    const c = await this.connectorOfAsync(integrationId);
    if (c && c.provider === 'composio') {
      const dt = (await this.dynToolsFor(c.toolkit)).find((x) => x.name === name);
      if (!dt) throw new Error(`连接器没有工具 ${name}`);
      return this.execComposio(c, integrationId, dt.slug, args);
    }
    const t = c?.tools.find((x) => x.name === name);
    if (!c || !t) throw new Error(`连接器没有工具 ${name}`);
    if (this.backend() === 'composio') {
      const r = await this.composio!.tools.execute(t.composio.slug, { userId: OWNER, arguments: t.composio.map(args), dangerouslySkipVersionCheck: true });
      if (!r.successful) {
        if (/not connected|no connected account|expired|revoked|401/i.test(r.error ?? '')) this.store.patchIntegration(integrationId, { status: 'error', note: '授权失效，让 bot 重新发一张授权卡' });
        throw new Error(`${c.name} 返回错误：${(r.error ?? '未知错误').slice(0, 300)}`);
      }
      try {
        return t.composio.render(r.data);
      } catch {
        return compact(r.data);
      }
    }
    const call = async (url: string, init: RequestInit = {}) => {
      const token = await this.accessToken(integrationId);
      const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) } });
      if (res.status === 204) return {};
      const text = await res.text();
      if (!res.ok) {
        if (res.status === 401) this.store.patchIntegration(integrationId, { status: 'error', note: '授权失效，让 bot 重新发一张授权卡' });
        throw new Error(`${c.name} 返回 ${res.status}：${text.slice(0, 200)}`);
      }
      return text ? JSON.parse(text) : {};
    };
    return t.run(call, args);
  }

  private connectorOf(integrationId: string) {
    const integ = this.store.integration(integrationId);
    return integ?.connector ? connectorById(integ.connector) ?? this.dynamic.get(integ.connector) : undefined;
  }
  private async connectorOfAsync(integrationId: string) {
    const integ = this.store.integration(integrationId);
    return integ?.connector ? this.resolve(integ.connector) : undefined;
  }

  private tokenFile(integrationId: string) {
    return join(config.connectionsDir, `${integrationId}.json`);
  }
  private saveTokens(integrationId: string, t: Tokens) {
    this.tokens.set(integrationId, t);
    writeFileSync(this.tokenFile(integrationId), JSON.stringify(t));
    chmodSync(this.tokenFile(integrationId), 0o600);
  }
  private loadTokens(integrationId: string): Tokens | undefined {
    const cached = this.tokens.get(integrationId);
    if (cached) return cached;
    const f = this.tokenFile(integrationId);
    if (!existsSync(f)) return undefined;
    const t = JSON.parse(readFileSync(f, 'utf8')) as Tokens;
    this.tokens.set(integrationId, t);
    return t;
  }
  private async accessToken(integrationId: string): Promise<string> {
    const t = this.loadTokens(integrationId);
    if (!t) throw new Error('还没有授权');
    if (Date.now() < t.expires_at) return t.access_token;
    if (!t.refresh_token || !config.google) throw new Error('授权已过期且无法刷新');
    const body = new URLSearchParams({ refresh_token: t.refresh_token, client_id: config.google.clientId, client_secret: config.google.clientSecret, grant_type: 'refresh_token' });
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const j = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string; error?: string };
    if (!res.ok || !j.access_token) throw new Error(j.error_description ?? j.error ?? `refresh failed (${res.status})`);
    this.saveTokens(integrationId, { ...t, access_token: j.access_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 });
    return j.access_token;
  }
}
