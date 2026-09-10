import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Bridge, Hub } from './types.ts';
import type { Pending } from '../types.ts';
import { toWhatsapp } from './format.ts';

const GRAPH = 'https://graph.facebook.com/v21.0';
/** WhatsApp's own cap on a text body. */
const LIMIT = 4096;

/**
 * One bot's own WhatsApp number, over the Cloud API (Meta's official one; the unofficial protocols get numbers
 * banned). Inbound is a webhook — the only IM here that needs this machine to be reachable from the internet —
 * outbound is one POST per message. WhatsApp has no group API, so a bot is reachable in a private chat only.
 *
 * The rule that shapes everything: outside 24 hours from the person's last message, a business number may only
 * send a pre-approved template. So a bot cannot open a conversation here; the person writes first, and the bot
 * answers within the window (channels.ts holds nothing back — a late reply simply fails and says why).
 */
export class WhatsappBridge implements Bridge {
  readonly channel = 'whatsapp' as const;

  constructor(
    readonly botId: string,
    private creds: { phoneId: string; token: string; verifyToken: string },
    private hub: Hub,
  ) {}

  async start() {
    const r = await fetch(`${GRAPH}/${this.creds.phoneId}?fields=display_phone_number,verified_name`, { headers: { authorization: `Bearer ${this.creds.token}` } });
    const j = (await r.json().catch(() => ({}))) as { display_phone_number?: string; verified_name?: string; error?: { message?: string; code?: number } };
    if (!r.ok || j.error) {
      const msg = j.error?.message ?? `HTTP ${r.status}`;
      throw new Error(/token|OAuth|190/i.test(msg) ? '访问令牌不对或已过期（要用系统用户的永久令牌）' : /phone|100/i.test(msg) ? 'Phone number ID 不对' : `连不上 WhatsApp：${msg.slice(0, 80)}`);
    }
    return { account: j.verified_name ?? (j.display_phone_number ? `+${j.display_phone_number.replace(/^\+/, '')}` : undefined) };
  }

  stop() {
    /* webhook only: nothing is held open */
  }

  /** Meta verifies the webhook with a GET, then posts events to the same path. */
  async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'GET') {
      const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === this.creds.verifyToken;
      res.writeHead(ok ? 200 : 403, { 'content-type': 'text/plain' });
      res.end(ok ? (url.searchParams.get('hub.challenge') ?? '') : 'no');
      return true;
    }
    const body = await new Promise<string>((resolve) => {
      let s = '';
      req.on('data', (c: Buffer) => (s += c.toString()));
      req.on('end', () => resolve(s));
    });
    // Meta retries anything it does not get a prompt 200 for, so acknowledge before doing the work.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    try {
      this.dispatch(JSON.parse(body) as WaPayload);
    } catch (e) {
      console.warn('[crew] whatsapp webhook:', (e as Error).message);
    }
    return true;
  }

  private dispatch(p: WaPayload) {
    for (const entry of p.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const m of change.value?.messages ?? []) {
          if (!this.hub.first('whatsapp', m.id)) continue;
          const reply = m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id;
          if (reply?.startsWith('pending:')) {
            const [, pendingId, optionId] = reply.split(':');
            if (pendingId && optionId) this.hub.choice(pendingId, optionId);
            continue;
          }
          const text = m.text?.body?.trim() || m.button?.text?.trim();
          if (text) this.hub.dm(this.botId, 'whatsapp', m.from, text);
        }
      }
    }
  }

  private post(payload: unknown) {
    return fetch(`${GRAPH}/${this.creds.phoneId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.creds.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).then(async (r) => {
      if (r.ok) return;
      const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
      const msg = j.error?.message ?? `HTTP ${r.status}`;
      throw new Error(/24|re-?engagement|131047/i.test(msg) ? '超过 24 小时窗口了：对方要先再发一条消息，你才能回' : msg.slice(0, 160));
    });
  }

  async send(to: string, text: string, pending?: Pending) {
    const body = (text.trim() || pending?.title || '').slice(0, LIMIT);
    if (!body) return;
    // Three buttons is WhatsApp's limit for an interactive reply; more than that goes out as a numbered question.
    const opts = pending?.options ?? [];
    if (pending && opts.length && opts.length <= 3) {
      await this.post({
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: [pending.title, pending.detail, pending.amount ? `¥${pending.amount}` : ''].filter(Boolean).join('\n').slice(0, 1024) },
          action: { buttons: opts.map((o) => ({ type: 'reply', reply: { id: `pending:${pending.id}:${o.id}`.slice(0, 256), title: o.label.slice(0, 20) } })) },
        },
      });
      return;
    }
    const marked = toWhatsapp(body);
    const listed = pending && opts.length ? `${marked}\n\n${opts.map((o, i) => `${i + 1}. ${o.label}${o.hint ? `（${o.hint}）` : ''}`).join('\n')}\n（回数字选一个）` : marked;
    await this.post({ messaging_product: 'whatsapp', to, type: 'text', text: { body: listed.slice(0, LIMIT), preview_url: false } });
  }
}

interface WaPayload {
  entry?: {
    changes?: {
      value?: {
        messages?: {
          id: string;
          from: string;
          text?: { body?: string };
          button?: { text?: string };
          interactive?: { button_reply?: { id?: string }; list_reply?: { id?: string } };
        }[];
      };
    }[];
  }[];
}
