import { join } from 'node:path';
import type { CrewStore } from './store.ts';
import type { BotManager } from './bots.ts';
import type { McpManager } from './integrations.ts';
import type { ConnectorManager } from './connectors.ts';
import type { DesktopManager } from './desktop.ts';
import type { Runtime } from './runtime.ts';
import type { SkillStores } from './skills.ts';
import type { Library } from './library.ts';
import type { Router } from './router.ts';
import type { VigilManager } from './vigil.ts';
import type { AvatarService } from './avatar.ts';
import type { ChannelManager } from './channels.ts';
import type { CrewOps } from './extensions/crew-tools.ts';
import { botThread, matterThread, type Bot } from './types.ts';
import { existsSync, readdirSync, realpathSync, copyFileSync } from 'node:fs';
import { relative } from 'node:path';
import { config } from './config.ts';
import { channelFromName } from './types.ts';
import { publicIp } from './util.ts';
import { KIND_LABEL, LIBRARY_CATEGORIES } from './library.ts';
import { buildLabel, runBuild } from './builder.ts';
import { POPULAR_TOOLKITS, isChinesePlatform } from './connectors.ts';
import { CHANNEL_PATTERNS, CHANNEL_PUBLIC_KEYS, IM_NAME, connectCard, missingChannelCreds, saveBotChannelCreds, wecomCallback, whatsappCallback } from './channels.ts';
import { secretsChanged } from './secrets.ts';
import { kick as kickDeps, ready as depsReady } from './deps.ts';
import { fetchAssets } from './assets.ts';
import { loadMachine, probeMachine, portOf } from './machine.ts';
import type { LoginDesk } from './login.ts';

/**
 * What a bot can do to this crew — create a colleague, open a group, mount a manual, connect a messenger, look at
 * the machine. This is where the bot tools actually land, and the part of the product certain to keep growing. It
 * used to be an anonymous object literal in the middle of index.ts, fed by variables from a 1500-line closure;
 * the dependencies are now written out in CrewOpsDeps, so adding an ability no longer means squeezing into it.
 */
export interface CrewOpsDeps {
  store: CrewStore;
  bots: BotManager;
  mcp: McpManager;
  connectors: ConnectorManager;
  desktops: DesktopManager;
  runtime: Runtime;
  skills: SkillStores;
  library: Library;
  router: Router;
  vigil: VigilManager;
  avatars: AvatarService;
  channels: ChannelManager;
  /** Helpers from index.ts; the signatures are as they stand. */
  ensureAvatar: (bot: Bot) => Promise<void>;
  mountLibrary: (botId: string, slugs: string[]) => string[];
  needsFor: (botId: string) => { slugs: string[]; line: string } | undefined;
  equipLog: { botId: string; slug: string; at: number }[];
  /** The login desk is built after ops in index.ts, so this has to be lazy — a value here would be a ReferenceError. */
  logins: () => LoginDesk;
  createBotFromBrief: (brief: string, opts: { userMessageId?: string; name?: string; announce?: (b: Bot) => void; task?: string; fromBotId?: string }) => Promise<Bot>;
}

export function makeCrewOps(d: CrewOpsDeps): CrewOps {
  const { store, bots, mcp, connectors, desktops, runtime, skills, library, router, vigil, avatars, channels, ensureAvatar, mountLibrary, needsFor, equipLog, createBotFromBrief } = d;
  const logins = d.logins;
  return {
    connectChannel: (botId, channel, threadId) => {
      channels.sendConnectCard(botId, channel, threadId);
    },
    disconnectChannel: (botId, channel) => channels.disconnect(botId, channel),
    createBot: (brief, o) => createBotFromBrief(brief, { name: o.name, fromBotId: o.byBotId, task: o.task }),
    async machineStatus() {
      const info = runtime.info();
      const here = { hostname: info.hostname, platform: info.platform, mode: info.mode, bots: store.data.bots.length, local: info.local };
      const m = loadMachine();
      if (!m) return { here };
      const probe = m.url && m.token ? await probeMachine({ url: m.url, token: m.token }) : undefined;
      return { here, target: { name: m.name, host: m.host, user: m.user, connectedAt: m.connectedAt, url: m.url, port: m.url ? portOf(m.url) : undefined, pairedAt: m.pairedAt, reachable: probe?.reachable, note: probe?.note } };
    },
    /**
     * A credential from a page in the shared browser into the bot's own account, without a model in between. The
     * bot names the tab (a piece of its URL) and the field; the server reads the page over CDP, keeps the one value
     * that has the field's shape (or the one next to `near` / at `selector`), stores it, and starts the bridge once
     * every field is in. Only a masked echo goes back.
     */
    async harvest(botId, spec) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('no such bot');
      const im = channelFromName(spec.target);
      const integ = im ? undefined : store.data.integrations.find((i) => i.id === spec.target || i.name === spec.target || i.name.toLowerCase() === spec.target.toLowerCase());
      if (!im && !integ) throw new Error(`"${spec.target}" is neither a messenger (WeChat / Feishu / Telegram / Slack / WeCom) nor an existing connection. To connect an external tool, create the connection first with build(aspect=mcp, action=add).`);
      if (im && im === 'app') throw new Error('the App needs no credentials');
      // WeChat is not harvested: its credential comes back from the QR the user scans, never off a page.
      if (im === 'weixin')
        throw new Error(
          'WeChat is never harvested: it has no console and no secret to copy. build(aspect=channel, action=add, value="WeChat") puts a QR code in the thread, and one scan connects it.',
        );

      if (spec.action === 'info') {
        if (im) {
          const card = connectCard(bot, im);
          const missing = new Set(missingChannelCreds(botId, im));
          const lines = card.fields.map((f) => `- ${f.label} (key ${f.key})${f.hint ? `, ${f.hint}` : ''}: ${missing.has(f.key) ? 'not yet' : 'received'}`);
          const extra: string[] = [`Name the bot "${bot.name}" and use its avatar.`];
          if (im === 'wechat') extra.push(`Callback URL: ${wecomCallback(botId)}`, `This machine's public IP (for trusted enterprise IPs): ${await publicIp()}`);
          if (im === 'whatsapp') extra.push(`Webhook callback URL: ${whatsappCallback(botId)}`, 'Make up a verify token and use the same one in the Meta console and here', "Use a system user's permanent token; the temporary one on the page expires in 24 hours");
          if (im === 'feishu') extra.push('Choose long connection for events, which needs no public address; the app only takes effect once a version is created and published.');
          if (im === 'slack') extra.push('Socket Mode on is enough; no public address needed.');
          extra.push(`Console: ${card.help?.url ?? ''}`, ...(card.help?.steps ?? []).map((x, i) => `${i + 1}. ${x}`));
          const already = bot.im?.[im]?.status === 'ok' ? `\nYou are already on ${IM_NAME[im]} (${bot.im[im]?.account ?? ''}).` : '';
          return `${IM_NAME[im]} needs these:\n${lines.join('\n')}\n${extra.join('\n')}${already}`;
        }
        const env = integ!.env ?? {};
        const keys = Object.keys(env);
        return keys.length ? `Environment variables for "${integ!.name}": ${keys.map((k) => `${k}: ${env[k] ? 'set' : 'not yet'}`).join(', ')}. Status ${integ!.status}${integ!.note ? ` (${integ!.note})` : ''}.` : `"${integ!.name}" needs no credentials. Status ${integ!.status}.`;
      }

      if (!spec.url) throw new Error('take needs url: a distinctive piece of your current tab address');
      if (!desktops.isOn()) throw new Error('the computer is not on; computer(open) first');
      // Which field
      let key: string;
      let publicKey = false;
      let pattern: RegExp | undefined;
      let label: string;
      const squash = (x: string) => x.replace(/[\s-]/g, '').toLowerCase();
      if (im) {
        const card = connectCard(bot, im);
        const want = squash(spec.field ?? '');
        const f = card.fields.find((x) => squash(x.key) === want || squash(x.label) === want);
        if (!f) throw new Error(`${IM_NAME[im]} has no field "${spec.field ?? ''}". It wants: ${card.fields.map((x) => `${x.label} (${x.key})`).join(', ')}`);
        key = f.key;
        label = f.label;
        publicKey = CHANNEL_PUBLIC_KEYS.has(key);
        pattern = CHANNEL_PATTERNS[key];
      } else {
        const keys = Object.keys(integ!.env ?? {});
        const f = keys.find((k) => squash(k) === squash(spec.field ?? ''));
        if (!f) throw new Error(`"${integ!.name}" has no environment variable "${spec.field ?? ''}". It has: ${keys.join(', ') || '(none)'}`);
        key = f;
        label = f;
      }
      // Read the page
      const found = await desktops.readPage({ url: spec.url }, async (page) => {
        let scope = '';
        if (spec.selector) {
          const loc = page.locator(spec.selector).first();
          scope = ((await loc.inputValue().catch(() => '')) || (await loc.innerText().catch(() => '')) || (await loc.getAttribute('value').catch(() => '')) || '').trim();
          if (!scope) return { candidates: [] as string[], where: `the selector "${spec.selector}" matched no element with content` };
        } else {
          const got = (await page.evaluate(
            (near) => {
              const vals: string[] = [];
              for (const el of Array.from(document.querySelectorAll('input, textarea'))) {
                const v = (el as HTMLInputElement).value;
                if (v) vals.push(v);
              }
              for (const el of Array.from(document.querySelectorAll('[data-clipboard-text]'))) vals.push(el.getAttribute('data-clipboard-text') ?? '');
              if (near) {
                // The row the label sits in: the label's grandparent's text, minus the label itself.
                const all = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
                const hits = all.filter((el) => el.children.length === 0 && (el.innerText ?? '').trim() === near);
                const rows = hits.map((el) => ((el.parentElement?.parentElement ?? el.parentElement ?? el).innerText ?? '').replace(near, ' '));
                return { text: rows.join('\n'), vals: [], rows: hits.length };
              }
              return { text: document.body.innerText, vals, rows: -1 };
            },
            spec.near ?? '',
          )) as { text: string; vals: string[]; rows: number };
          if (spec.near && got.rows === 0) return { candidates: [] as string[], where: `nothing on the page is labelled exactly "${spec.near}"` };
          scope = [got.text, ...got.vals].join('\n');
        }
        const raw = pattern ? scope.match(pattern) ?? [] : scope.match(/[A-Za-z0-9_\-:.]{8,}/g) ?? [];
        return { candidates: [...new Set(raw)], where: '' };
      });
      if (found.candidates.length !== 1) {
        if (found.where) return `Nothing taken: ${found.where}. Try another near / selector.`;
        if (!found.candidates.length) return `No value shaped like ${label} on the page${pattern ? ` (${pattern.source})` : ''}. Is it still masked (press view / show)? Or not in this tab?`;
        return `${found.candidates.length} values on the page look like ${label} and this cannot tell them apart. Add near (the label beside it) or a selector and try again.`;
      }
      const value = found.candidates[0];
      // Store, never echo
      if (im) {
        saveBotChannelCreds(botId, im, { [key]: value });
        secretsChanged();
        const missing = missingChannelCreds(botId, im);
        const echo = publicKey ? value : `${value.slice(0, 2)}… (${value.length} characters)`;
        if (missing.length) {
          const card = connectCard(bot, im);
          return `Took ${label}: ${echo}, written into your ${IM_NAME[im]} account. Still missing: ${missing.map((k) => card.fields.find((f) => f.key === k)?.label ?? k).join(', ')}.`;
        }
        const r = await channels.start(botId, im);
        const b2 = store.bot(botId);
        return r.ok
          ? `Took ${label}: ${echo}. ${IM_NAME[im]} is connected${b2?.im?.[im]?.account ? `, where you are called "${b2.im[im]!.account}"` : ''}. Send a first message over there to confirm.`
          : `Took ${label}: ${echo}. Everything is there, but ${IM_NAME[im]} did not connect: ${r.note}. Check the settings on the platform (permissions, events, whether it is published), then harvest the offending field again.`;
      }
      const env = { ...(integ!.env ?? {}), [key]: value };
      store.patchIntegration(integ!.id, { env });
      secretsChanged();
      const empty = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
      if (empty.length) return `Took ${label} (${value.length} characters) into "${integ!.name}". Still missing: ${empty.join(', ')}.`;
      const after = await mcp.connect(integ!.id);
      await bots.ops!.grant(botId, integ!.id);
      return after?.status === 'ok' ? `Took ${label} (${value.length} characters). "${integ!.name}" is connected, and its ${after.tools?.length ?? 0} tools are in your list.` : `Took ${label} (${value.length} characters), but "${integ!.name}" did not connect: ${after?.note ?? ''}`;
    },
    /**
     * The last step of joining an IM, judged by the runtime rather than by the model: a code goes out, the bot
     * sends itself that line from the user's own client (on the shared computer), and the code coming back through
     * the bridge is the only thing that counts as connected.
     */
    async channelCheck(botId, channelName, action) {
      const im = channelFromName(channelName);
      if (!im || im === 'app') throw new Error(`"${channelName}" is not a messenger; use WeChat / Feishu / Telegram / Slack / WeCom`);
      const bot = store.bot(botId);
      const link = bot?.im?.[im];
      if (action === 'arm') {
        if (link?.status !== 'ok') return `${IM_NAME[im]} is not connected yet (${link?.status ?? 'no credentials'}); complete the credentials before verifying.`;
        const code = channels.armProbe(botId, im);
        return `Passphrase: ${code}. Now open the ${IM_NAME[im]} web client on the computer (the one the user is logged into), search for "${bot!.name}", and send it a message as the user containing ${code} — that one line is enough. Then channel_check(status) to see whether it arrived.`;
      }
      const p = channels.probeStatus(botId, im);
      if (p.state === 'ok') return `Passphrase ${p.code} came back: ${IM_NAME[im]} really works — the user can find you there and messages arrive. You can tell them.`;
      if (p.state === 'none') return 'No passphrase has been armed; channel_check(arm) first.';
      if (p.state === 'expired') return `Passphrase ${p.code} expired (over ten minutes). Arm another and send it again.`;
      return `Passphrase ${p.code} has not come back. Either it was never sent, or nothing arrives over there. Check in this order: is the app published (Feishu needs a version created, published and approved), does its availability include this user, is "receive message" among the subscribed events, and is long connection selected. Then send the same passphrase again.`;
    },
    async askLogin(botId, threadId, spec) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('no such bot');
      const thread = threadId ?? botThread(botId);
      if (spec.kind === 'password' && !spec.passwordSelector) throw new Error('kind=password needs passwordSelector: the CSS selector of the password field, read from the page snapshot');
      return logins().ask({
        botId,
        threadId: thread,
        kind: spec.kind,
        match: { url: spec.url },
        selector: spec.kind === 'qr' ? spec.selector : spec.passwordSelector,
        fields: spec.kind === 'password' ? { account: spec.accountSelector, password: spec.passwordSelector!, submit: spec.submitSelector } : undefined,
        title: spec.title,
        note: spec.note,
      });
    },
    librarySearch: (query, limit = 8) => (query.trim() ? library.search(query, limit) : library.list()).map((e) => ({ ...e, categoryLabel: LIBRARY_CATEGORIES[e.category] ?? e.category, kindLabel: KIND_LABEL[e.kind ?? 'skill'] })),
    libraryFind: async (query, limit = 8) => (await library.candidates(query, limit)).map((e) => ({ ...e, categoryLabel: LIBRARY_CATEGORIES[e.category] ?? e.category, kindLabel: KIND_LABEL[e.kind ?? 'skill'] })),
    /**
     * Equip a bot with one entry from the pool. Four kinds, four ways in, one door: the bot says what it wants and
     * gets back either "ready" or exactly what is missing. Dependencies, credentials and grants are handled here so
     * the bot never has to know that a manual is a directory and an MCP server is a process.
     */
    async equip(botId, slug, threadId) {
      const e = library.get(slug);
      if (!e) throw new Error(`the pool has no "${slug}"; find the slug with library(search) first`);
      const bot = store.bot(botId);
      if (!bot) throw new Error('no such bot');
      const kind = e.kind ?? 'skill';
      equipLog.push({ botId, slug: e.slug, at: Date.now() });
      if (equipLog.length > 400) equipLog.splice(0, 200);

      if (kind === 'skill') {
        const before = bot.skills ?? [];
        const added = mountLibrary(botId, [e.slug]);
        const already = !added.length && before.includes(e.title);
        // A manual whose tools are not here is worse than no manual: the bot follows it and hits the wall halfway.
        const req = skills.of(botId).requiresOf(e.title);
        const r = req ? await depsReady(req, e.slug) : undefined;
        const head = already ? `"${e.title}" is already among your skills; follow it.` : `Mounted "${e.title}"; follow the manual.`;
        if (r?.ok === false && r.pending) return { kind, text: `${head}\n${r.note}. Do something else, or come back to that step in a moment.` };
        return { kind, text: r?.ok === false ? `${head}\nNote: ${r.note}. The steps in the manual that need this cannot run on this machine — find another way, or tell the user what is missing.` : head };
      }

      if (kind === 'assets') {
        if (!e.assets?.url) throw new Error(`"${e.slug}" has no asset pack address`);
        const dir = join(config.botsDir, botId, 'workspace', '_assets', e.slug);
        const here = existsSync(dir) ? readdirSync(dir).length : 0;
        if (here) return { kind, text: `The asset pack "${e.title}" is already at ${relative(join(config.botsDir, botId), dir)} (${here} items); use it. ${e.assets.howto ?? ''}` };
        const got = await fetchAssets(e.assets.url, dir);
        return { kind, text: `The asset pack "${e.title}" is at ${relative(join(config.botsDir, botId), got.dir)} (${got.files} files). ${e.assets.howto ?? ''}${e.license ? ` Licence: ${e.license}.` : ''}` };
      }

      // mcp behind the product's OAuth service: the card is a login, not a key
      if (e.service) {
        const r = await bots.ops!.connect(botId, threadId, e.service, e.description);
        return { kind, text: r.text };
      }
      // mcp the bot connects to itself
      const m = e.mcp;
      if (!m) throw new Error(`"${e.slug}" does not say how to connect`);
      const existing = store.data.integrations.find((i) => i.kind === 'mcp' && i.name === e.title);
      const grant = (id: string) => bots.ops!.grant(botId, id);
      if (existing) {
        await grant(existing.id);
        return { kind, text: existing.status === 'ok' ? `"${e.title}" is already connected and its tools are in your list.` : `"${e.title}" exists but its status is ${existing.status}${existing.note ? ` (${existing.note})` : ''}. If a credential is missing, send a card with request_credentials.` };
      }
      // The server itself is a package: install it into the product's prefix so it does not download on every start
      // and does not vanish when the container is rebuilt.
      if (m.npm || m.pip) {
        const r = await depsReady({ npm: m.npm ? [m.npm] : [], pip: m.pip ? [m.pip] : [] }, e.slug);
        if (!r.ok) return { kind, text: r.pending ? `The server for "${e.title}" ${r.note}; you will be told when it is ready. Do something else.` : `Cannot install "${e.title}": ${r.note ?? ''}. Tell the user it will not install on this machine, or find another way.` };
      }
      const env = Object.fromEntries((m.env ?? []).map((f) => [f.key, '']));
      const added = await bots.ops!.addMcp({ name: e.title, command: m.command, args: m.args, url: m.url, env: (m.env ?? []).length ? env : undefined, headers: m.headers });
      await grant(added.id);
      if ((m.env ?? []).length) {
        // Keys are the user's to bring: the card writes them straight into the connection, out of the conversation.
        store.addMessage({
          threadId,
          author: 'bot',
          botId,
          text: `${e.title} needs ${m.env!.length > 1 ? 'a set of credentials' : 'a credential'} before it works. Fill in the card — I cannot see what you type, and it connects itself once saved.`,
          ts: Date.now(),
          card: { type: 'secrets', integrationId: added.id, title: `Add the credentials for ${e.title}`, fields: m.env!.map((f) => ({ ...f, secret: f.secret ?? true })), help: m.help },
        });
        return { kind, text: `"${e.title}" is created and a credential card is in the thread (it wants ${m.env!.map((f) => f.label).join(', ')}). The system connects it and tells you once they fill it in; do not chase it — do something else or end the turn.` };
      }
      return { kind, text: added.status === 'ok' ? `"${e.title}" is connected, and its ${added.tools ?? 0} tools are in your list. ${m.tools ?? ''}` : `"${e.title}" was created with status ${added.status}: ${added.note ?? ''}` };
    },
    async createGroup(o) {
      const matter = router.createMatter({ title: o.title, summary: o.summary, memberIds: o.memberIds, leadId: o.leadId, quiet: !!o.task });
      if (o.task) {
        const from = store.bot(o.byBotId);
        const threadId = matterThread(matter.id);
        store.addMessage({ threadId, author: 'bot', botId: o.byBotId, text: o.task, ts: Date.now() });
        const line = `[Group "${matter.title}" · from @${from?.name ?? o.byBotId}] ${o.task}`;
        // One task wakes one bot — whoever leads. Sending it to every member as a direct message had all of
        // them start the same work at once while the lead (the creator, by default) did nothing.
        const lead = matter.ownerBotId;
        for (const id of [matter.ownerBotId, ...matter.participantBotIds]) {
          if (id === lead) continue;
          void bots.send(id, { threadId, kind: 'group', text: `[Group log] ${from?.name ?? o.byBotId} said in "${matter.title}": ${o.task}` });
        }
        void bots.send(
          lead,
          lead === o.byBotId
            ? { threadId, kind: 'system', text: `You opened this in the group "${matter.title}": ${o.task}\nYou lead it. Push it along in the group from here: do what you can yourself, and assign the rest with todo(create, assignee=name, brief=the whole briefing), then @ them.`, depth: 1 }
            : { threadId, kind: 'bot', text: line, fromBotId: o.byBotId, depth: 1 },
        );
      }
      return matter;
    },
    async grant(botId, integrationId) {
      const b = store.bot(botId);
      if (!b || (b.integrationIds ?? []).includes(integrationId)) return;
      store.patchBot(botId, { integrationIds: [...(b.integrationIds ?? []), integrationId] });
      await bots.refreshTools(botId);
    },
    async addMcp(i) {
      const integ = store.addIntegration({ kind: 'mcp', name: i.name, transport: i.url ? 'http' : 'stdio', command: i.command, args: i.args, url: i.url, env: i.env, headers: i.headers, status: 'connecting' });
      // `npx -y some-server` is a package like any other: recorded now, it is installed into the product's prefix
      // instead of being fetched on every start, and it comes back by itself on the next machine.
      kickDeps(`connection ${i.name}`);
      const done = await mcp.connect(integ.id);
      return { id: integ.id, status: done?.status ?? 'error', note: done?.note, tools: done?.tools?.length };
    },
    async build(botId, spec) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('no such bot');
      const job = { id: `bld_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, aspect: spec.aspect, label: buildLabel(spec), since: Date.now(), skill: spec.skill };
      store.patchBot(botId, { building: [...(bot.building ?? []), job] });
      void runBuild({ store, skills: (id) => skills.of(id), runtime: bots.modelRuntime, model: bots.lightModel, onSkillWritten: (id) => bots.recycle(id), needs: needsFor }, botId, job, spec);
      return job;
    },
    async connect(botId, threadId, service, why) {
      const c = await connectors.resolve(service);
      if (!c && isChinesePlatform(service)) return { status: 'unknown', text: `"${service}" is not one-click (the connector service does not cover Feishu, DingTalk, WeChat and other Chinese platforms). Feishu as a messenger can be connected under Integrations › Channels; reading its documents or calendar has to go the manual route in the "Connecting an external service" manual. Tell the user plainly.` };
      if (!c) return { status: 'unknown', text: `The connector service has no platform called "${service}". service takes the platform slug; common ones are: ${POPULAR_TOOLKITS.join(', ')}. If the name is uncertain, try another spelling (google drive → googledrive, feishu → lark). For one genuinely unsupported, take the manual route in the "Connecting an external service" manual.` };
      if (!connectors.available(c)) return { status: 'unavailable', text: `One-click connection for ${c.name} is not enabled in this deployment (no connector service is configured). Tell the user plainly that it is not available yet and ask whether to do something else instead. Do not send them off to find a token, an app password, or to change mail settings.` };
      let existing = store.data.integrations.find((i) => i.connector === c.id);
      if (existing?.status !== 'ok') existing = (await connectors.reconcile(c)) ?? existing;
      const bot = store.bot(botId);
      if (existing?.status === 'ok' && bot) {
        if (!(bot.integrationIds ?? []).includes(existing.id)) {
          store.patchBot(botId, { integrationIds: [...(bot.integrationIds ?? []), existing.id] });
          await bots.refreshTools(botId);
        }
        return { status: 'connected', text: `${c.name} has been connected for a while (${existing.account ?? ''}) and its tools are in your list; just use them.` };
      }
      let started: Awaited<ReturnType<typeof connectors.startUrl>>;
      try {
        started = await connectors.startUrl(c, { botId, threadId });
      } catch (e) {
        console.warn('[crew] connect failed:', (e as Error).message);
        return { status: 'unavailable', text: `The connector service for ${c.name} is not answering right now, so no authorisation card can be sent. Tell the user it is temporarily unavailable and you will try later, then ask whether to do something else. Do not send them off to find a token, an app password, or to change mail settings.` };
      }
      const { url, integration } = started;
      const msg = store.addMessage({ threadId, author: 'bot', botId, text: `Let me connect ${c.name}. Press this card and sign in.`, ts: Date.now(), card: { type: 'connect', connector: c.id, name: c.name, blurb: why?.trim() ? `Once connected: ${why.trim().replace(/[。.]$/, '')}` : c.blurb, url, integrationId: integration.id } });
      void msg;
      return { status: 'card', text: `The authorisation card is in the thread. The system tells you once they approve, and ${c.name}'s tools appear in your list then. Do not chase it: say one line asking them to press the card, then carry on with something else or end the turn.` };
    },
    removeIntegration(id) {
      const i = store.integration(id);
      void (i?.connector ? connectors.disconnect(id) : mcp.disconnect(id));
      store.removeIntegration(id);
    },
    vigil: () => vigil,
    async avatar(botId, value) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('no such bot');
      const v = value.trim();
      if (!v) throw new Error('avatar needs a value: regen / reset / a sentence describing a look / a path to an image');
      if (v === 'reset') {
        store.patchBot(bot.id, { avatarUrl: undefined, avatarLook: undefined });
        return `${bot.name}'s avatar is back to the default.`;
      }
      // An image the bot made: only from its own directory, copied into the avatar store.
      if (v.startsWith('/') && /\.(png|jpe?g|webp)$/i.test(v)) {
        const botDir = join(config.botsDir, bot.id);
        const real = existsSync(v) ? realpathSync(v) : '';
        if (!real || !real.startsWith(realpathSync(botDir))) throw new Error('the image has to be in your own directory (your workspace); files elsewhere are not accepted');
        const ext = /\.jpe?g$/i.test(real) ? 'jpg' : /\.webp$/i.test(real) ? 'webp' : 'png';
        const dst = join(config.avatarsDir, `${bot.id}.${ext}`);
        copyFileSync(real, dst);
        store.patchBot(bot.id, { avatarUrl: `/avatars/${bot.id}.${ext}?v=${Date.now()}` });
        return `${bot.name}'s avatar is now the image you gave.`;
      }
      if (!avatars.available()) throw new Error('no image model is configured, so a new avatar cannot be drawn; use reset, or give an image you generated');
      const look = v === 'regen' ? bot.avatarLook : v;
      const seed = `${bot.name}:${Date.now()}`;
      const next = store.patchBot(bot.id, { avatarSeed: seed, avatarUrl: undefined, avatarLook: look }) ?? bot;
      await ensureAvatar({ ...next, avatarUrl: undefined });
      const after = store.bot(bot.id);
      if (!after?.avatarUrl) throw new Error('the image model produced nothing this time; try again shortly');
      return `${bot.name}'s avatar has been redrawn${look ? ` (look: ${look})` : ''}.`;
    },
  } satisfies CrewOps;
}
