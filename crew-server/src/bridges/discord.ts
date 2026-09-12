import WebSocket from 'ws';
import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';

const API = 'https://discord.com/api/v10';
/** GUILDS | GUILD_MESSAGES | DIRECT_MESSAGES | MESSAGE_CONTENT — read what people write, in servers and in DMs. */
const INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | (1 << 15);
const LIMIT = 2000;

interface Payload {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
}

/**
 * One bot's own Discord bot, over the gateway websocket (bot token only, no public URL). A DM is the bot's own
 * thread; a server channel it is talked to in becomes a 群聊 shared with our other bots there. Cards are message
 * components, and a button press arrives as an interaction on the same socket — nothing here needs an inbound URL.
 */
export class DiscordBridge implements Bridge {
  readonly channel = 'discord' as const;
  private ws: WebSocket | undefined;
  private beat: ReturnType<typeof setInterval> | undefined;
  private seq: number | null = null;
  private running = false;
  private me: { id?: string; username?: string } = {};
  private retry = 0;

  constructor(
    readonly botId: string,
    private token: string,
    private hub: Hub,
  ) {}

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const r = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bot ${this.token}`, 'content-type': 'application/json', ...(init?.headers ?? {}) } });
    if (!r.ok) throw new Error(`Discord ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return (await r.json().catch(() => ({}))) as T;
  }

  async start() {
    let me: { id: string; username: string };
    try {
      me = await this.api<{ id: string; username: string }>('/users/@me');
    } catch (e) {
      throw new Error(/401/.test((e as Error).message) ? 'Bot Token 不对' : `连不上 Discord：${(e as Error).message.slice(0, 80)}`);
    }
    this.me = me;
    this.hub.register('discord', me.id, this.botId);
    this.running = true;
    await this.connect();
    return { account: `@${me.username}` };
  }

  private async connect() {
    const { url } = await this.api<{ url: string }>('/gateway/bot');
    if (!this.running) return;
    const ws = new WebSocket(`${url}?v=10&encoding=json`);
    this.ws = ws;
    ws.on('message', (raw: Buffer) => {
      let p: Payload;
      try {
        p = JSON.parse(raw.toString()) as Payload;
      } catch {
        return;
      }
      if (typeof p.s === 'number') this.seq = p.s;
      void this.onPayload(p, ws).catch((e: Error) => console.warn('[crew] discord event failed:', e.message));
    });
    ws.on('close', () => {
      if (this.beat) clearInterval(this.beat);
      if (!this.running) return;
      // The gateway drops connections routinely (op 7, a deploy on their side); coming back is normal operation.
      const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
      setTimeout(() => this.running && void this.connect().catch((e: Error) => console.warn('[crew] discord reconnect failed:', e.message)), wait);
    });
    ws.on('error', (e: Error) => console.warn('[crew] discord socket:', e.message));
  }

  private async onPayload(p: Payload, ws: WebSocket) {
    if (p.op === 10) {
      const { heartbeat_interval: iv } = p.d as { heartbeat_interval: number };
      this.beat = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ op: 1, d: this.seq })), iv);
      this.beat.unref?.();
      ws.send(JSON.stringify({ op: 2, d: { token: this.token, intents: INTENTS, properties: { os: 'linux', browser: 'steadbot', device: 'steadbot' } } }));
      return;
    }
    if (p.op === 1) return void ws.send(JSON.stringify({ op: 1, d: this.seq }));
    if (p.op === 7 || p.op === 9) return void ws.close();
    if (p.op !== 0) return;
    if (p.t === 'READY') {
      this.retry = 0;
      const d = p.d as { user?: { id: string; username: string } };
      if (d.user) {
        this.me = d.user;
        this.hub.register('discord', d.user.id, this.botId);
      }
      return;
    }
    if (p.t === 'MESSAGE_CREATE') return this.onMessage(p.d as DiscordMessage);
    if (p.t === 'INTERACTION_CREATE') {
      const d = p.d as { id: string; token: string; type: number; data?: { custom_id?: string } };
      const id = d.data?.custom_id ?? '';
      if (d.type !== 3 || !id.startsWith('pending:')) return;
      // Acknowledge first: Discord gives three seconds before it tells the user the interaction failed.
      await fetch(`${API}/interactions/${d.id}/${d.token}/callback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 6 }) }).catch(() => undefined);
      const [, pendingId, optionId] = id.split(':');
      if (pendingId && optionId) this.hub.choice(pendingId, optionId);
    }
  }

  private async channelName(id: string): Promise<string | undefined> {
    const c = await this.api<{ name?: string }>(`/channels/${id}`).catch(() => undefined);
    return c?.name ? `#${c.name}` : undefined;
  }

  private async onMessage(m: DiscordMessage) {
    if (!m.content || m.author?.bot || m.author?.id === this.me.id) return;
    if (!m.guild_id) return void this.hub.dm(this.botId, 'discord', m.channel_id, m.content.trim());
    // Every one of our bots in the server sees the same message on its own socket; the hub takes it once.
    if (!this.hub.first('discord', m.id)) return;
    const text = m.content
      .replace(/<@!?(\d+)>/g, (_s, id: string) => {
        const bot = this.hub.botByIdentity('discord', id);
        return bot ? ` @${bot.name} ` : ' ';
      })
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) return;
    await this.hub.group(this.botId, 'discord', m.channel_id, text, () => this.channelName(m.channel_id));
  }

  stop() {
    this.running = false;
    if (this.beat) clearInterval(this.beat);
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  async send(channelId: string, text: string, pending?: Pending) {
    const body = (text.trim() || pending?.title || '').slice(0, LIMIT);
    if (!body) return;
    // Five buttons per row is Discord's limit; anything past that goes as text the user can answer in words.
    const opts = pending?.options.slice(0, 5) ?? [];
    const components = pending && opts.length
      ? [{ type: 1, components: opts.map((o) => ({ type: 2, style: o.primary ? 1 : 2, label: (o.hint ? `${o.label} · ${o.hint}` : o.label).slice(0, 80), custom_id: `pending:${pending.id}:${o.id}`.slice(0, 100) })) }]
      : undefined;
    await this.api(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content: body, components }) });
  }
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: { id: string; bot?: boolean; username?: string };
}
