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
 * 「一个 bot 能对这个 crew 做什么」——建同事、拉群、装手册、接渠道、看机器……这些是 bot 工具真正的落点，
 * 也是这个产品注定还会长的那一块。它本来是 index.ts 中段一个匿名对象字面量，靠 1500 行闭包里的
 * 变量喂养；现在依赖显式写在 CrewOpsDeps 里，加一个能力不用再往那个闭包里挤。
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
  /** 这几个是 index.ts 里的小助手，签名就是它们现在的样子 */
  ensureAvatar: (bot: Bot) => Promise<void>;
  mountLibrary: (botId: string, slugs: string[]) => string[];
  needsFor: (botId: string) => { slugs: string[]; line: string } | undefined;
  equipLog: { botId: string; slug: string; at: number }[];
  /** 登录台在 index.ts 里比 ops 晚建出来，所以这里只能惰性拿——写成值会是 ReferenceError。 */
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
      if (!bot) throw new Error('bot 不存在');
      const im = channelFromName(spec.target);
      const integ = im ? undefined : store.data.integrations.find((i) => i.id === spec.target || i.name === spec.target || i.name.toLowerCase() === spec.target.toLowerCase());
      if (!im && !integ) throw new Error(`「${spec.target}」既不是 IM（微信 / 飞书 / Telegram / Slack / 企业微信），也不是已建好的连接。接外部工具先 build(aspect=mcp, action=add) 建连接。`);
      if (im && im === 'app') throw new Error('App 不需要凭据');
      // 微信 is not harvested: its credential comes back from the QR the user scans, never off a page.
      if (im === 'weixin')
        throw new Error(
          '微信不用 harvest：它没有后台、没有要抄的密钥。build(aspect=channel, action=add, value="微信") 会在对话里发一张二维码，用户用微信扫一下就接上了。',
        );

      if (spec.action === 'info') {
        if (im) {
          const card = connectCard(bot, im);
          const missing = new Set(missingChannelCreds(botId, im));
          const lines = card.fields.map((f) => `- ${f.label}（key ${f.key}）${f.hint ? `，${f.hint}` : ''}：${missing.has(f.key) ? '还没有' : '已收到'}`);
          const extra: string[] = [`机器人名字用「${bot.name}」，头像用它的头像。`];
          if (im === 'wechat') extra.push(`回调 URL：${wecomCallback(botId)}`, `本机公网 IP（填「企业可信 IP」）：${await publicIp()}`);
          if (im === 'whatsapp') extra.push(`Webhook 回调 URL：${whatsappCallback(botId)}`, '校验串（Verify token）自己起一个，Meta 后台和这里填同一个', '要用系统用户的永久令牌，页面上那个临时令牌 24 小时就过期');
          if (im === 'feishu') extra.push('事件订阅选「长连接」，不需要公网地址；应用要「创建版本并发布」才生效。');
          if (im === 'slack') extra.push('Socket Mode 开着就行，不需要公网地址。');
          extra.push(`平台后台：${card.help?.url ?? ''}`, ...(card.help?.steps ?? []).map((x, i) => `${i + 1}. ${x}`));
          const already = bot.im?.[im]?.status === 'ok' ? `\n你已经在${IM_NAME[im]}上了（${bot.im[im]?.account ?? ''}）。` : '';
          return `${IM_NAME[im]}要这几项：\n${lines.join('\n')}\n${extra.join('\n')}${already}`;
        }
        const env = integ!.env ?? {};
        const keys = Object.keys(env);
        return keys.length ? `连接「${integ!.name}」的环境变量：${keys.map((k) => `${k}：${env[k] ? '已有' : '还没有'}`).join('、')}。状态 ${integ!.status}${integ!.note ? `（${integ!.note}）` : ''}。` : `连接「${integ!.name}」不需要凭据。状态 ${integ!.status}。`;
      }

      if (!spec.url) throw new Error('take 要 url：你当前标签页网址里独有的一段');
      if (!desktops.isOn()) throw new Error('电脑没开，先 computer(open)');
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
        if (!f) throw new Error(`${IM_NAME[im]}没有「${spec.field ?? ''}」这一项。它要的是：${card.fields.map((x) => `${x.label}（${x.key}）`).join('、')}`);
        key = f.key;
        label = f.label;
        publicKey = CHANNEL_PUBLIC_KEYS.has(key);
        pattern = CHANNEL_PATTERNS[key];
      } else {
        const keys = Object.keys(integ!.env ?? {});
        const f = keys.find((k) => squash(k) === squash(spec.field ?? ''));
        if (!f) throw new Error(`连接「${integ!.name}」的环境变量里没有「${spec.field ?? ''}」。有的是：${keys.join('、') || '（没有）'}`);
        key = f;
        label = f;
      }
      // Read the page
      const found = await desktops.readPage({ url: spec.url }, async (page) => {
        let scope = '';
        if (spec.selector) {
          const loc = page.locator(spec.selector).first();
          scope = ((await loc.inputValue().catch(() => '')) || (await loc.innerText().catch(() => '')) || (await loc.getAttribute('value').catch(() => '')) || '').trim();
          if (!scope) return { candidates: [] as string[], where: `selector「${spec.selector}」没有匹配到有内容的元素` };
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
          if (spec.near && got.rows === 0) return { candidates: [] as string[], where: `页面上没有正好叫「${spec.near}」的标签` };
          scope = [got.text, ...got.vals].join('\n');
        }
        const raw = pattern ? scope.match(pattern) ?? [] : scope.match(/[A-Za-z0-9_\-:.]{8,}/g) ?? [];
        return { candidates: [...new Set(raw)], where: '' };
      });
      if (found.candidates.length !== 1) {
        if (found.where) return `没收到：${found.where}。换个 near / selector 再试。`;
        if (!found.candidates.length) return `页面上没有找到${label}这种格式的值${pattern ? `（${pattern.source}）` : ''}。它是不是还被遮着（点「查看 / 显示」）？或者不在这个标签页上。`;
        return `页面上有 ${found.candidates.length} 个像${label}的值，分不清哪个是。加 near（它旁边的标签文字）或 selector 再来一次。`;
      }
      const value = found.candidates[0];
      // Store, never echo
      if (im) {
        saveBotChannelCreds(botId, im, { [key]: value });
        secretsChanged();
        const missing = missingChannelCreds(botId, im);
        const echo = publicKey ? value : `${value.slice(0, 2)}…（${value.length} 位）`;
        if (missing.length) {
          const card = connectCard(bot, im);
          return `收到 ${label}：${echo}，已写进你的${IM_NAME[im]}账号。还差：${missing.map((k) => card.fields.find((f) => f.key === k)?.label ?? k).join('、')}。`;
        }
        const r = await channels.start(botId, im);
        const b2 = store.bot(botId);
        return r.ok
          ? `收到 ${label}：${echo}。${IM_NAME[im]}接上了${b2?.im?.[im]?.account ? `，那边你叫「${b2.im[im]!.account}」` : ''}。去那边发第一条消息确认一下。`
          : `收到 ${label}：${echo}，几项都齐了，但${IM_NAME[im]}没接上：${r.note}。核对一下平台那边的设置（权限、事件、是否发布），改好后 harvest 重新收出错的那一项即可。`;
      }
      const env = { ...(integ!.env ?? {}), [key]: value };
      store.patchIntegration(integ!.id, { env });
      secretsChanged();
      const empty = Object.entries(env).filter(([, v]) => !v).map(([k]) => k);
      if (empty.length) return `收到 ${label}（${value.length} 位），已写进连接「${integ!.name}」。还差：${empty.join('、')}。`;
      const after = await mcp.connect(integ!.id);
      await bots.ops!.grant(botId, integ!.id);
      return after?.status === 'ok' ? `收到 ${label}（${value.length} 位）。「${integ!.name}」接好了，${after.tools?.length ?? 0} 个工具在你的列表里。` : `收到 ${label}（${value.length} 位），但「${integ!.name}」没连上：${after?.note ?? ''}`;
    },
    /**
     * The last step of joining an IM, judged by the runtime rather than by the model: a code goes out, the bot
     * sends itself that line from the user's own client (on the shared computer), and the code coming back through
     * the bridge is the only thing that counts as connected.
     */
    async channelCheck(botId, channelName, action) {
      const im = channelFromName(channelName);
      if (!im || im === 'app') throw new Error(`「${channelName}」不是 IM，写微信 / 飞书 / Telegram / Slack / 企业微信`);
      const bot = store.bot(botId);
      const link = bot?.im?.[im];
      if (action === 'arm') {
        if (link?.status !== 'ok') return `「${IM_NAME[im]}」还没接上（${link?.status ?? '没有凭据'}），先把凭据收齐再验收。`;
        const code = channels.armProbe(botId, im);
        return `暗号：${code}。现在去电脑上打开${IM_NAME[im]}的网页版（用户已经登录的那个），搜「${bot!.name}」，以用户的身份给它发一条消息，内容里带上 ${code}（只发这一行就行）。发完用 channel_check(status) 看有没有收到。`;
      }
      const p = channels.probeStatus(botId, im);
      if (p.state === 'ok') return `收到了暗号 ${p.code}：${IM_NAME[im]}真的通了，用户在那边找得到你、消息进得来。可以告诉用户了。`;
      if (p.state === 'none') return '还没发暗号，先 channel_check(arm)。';
      if (p.state === 'expired') return `暗号 ${p.code} 过期了（超过十分钟）。重新 arm 一个再发一次。`;
      return `暗号 ${p.code} 还没回来。要么消息还没发出去，要么那边根本收不到——按这个顺序查：应用发布了吗（飞书要「版本管理与发布」发一版并通过审核）、可用范围包不包括这个用户、事件订阅有没有加「接收消息」、长连接选没选。改完再发一次同一条暗号。`;
    },
    async askLogin(botId, threadId, spec) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('找不到这个 bot');
      const thread = threadId ?? botThread(botId);
      if (spec.kind === 'password' && !spec.passwordSelector) throw new Error('kind=password 要给 passwordSelector：密码输入框的 CSS 选择器，从页面快照里读');
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
      if (!e) throw new Error(`库里没有「${slug}」，先用 library(search) 找到 slug`);
      const bot = store.bot(botId);
      if (!bot) throw new Error('找不到这个 bot');
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
        const head = already ? `「${e.title}」已经在你的技能里了，直接照着做。` : `已挂上「${e.title}」，按手册的步骤做。`;
        if (r?.ok === false && r.pending) return { kind, text: `${head}\n${r.note}。先做别的，或者过一会儿再用到那一步。` };
        return { kind, text: r?.ok === false ? `${head}\n注意：${r.note}。手册里用到这部分的步骤在这台机器上跑不了，换个做法，或者告诉用户差什么。` : head };
      }

      if (kind === 'assets') {
        if (!e.assets?.url) throw new Error(`「${e.slug}」没写素材包地址`);
        const dir = join(config.botsDir, botId, 'workspace', '_assets', e.slug);
        const here = existsSync(dir) ? readdirSync(dir).length : 0;
        if (here) return { kind, text: `素材包「${e.title}」已经在 ${relative(join(config.botsDir, botId), dir)}（${here} 项），直接用。${e.assets.howto ?? ''}` };
        const got = await fetchAssets(e.assets.url, dir);
        return { kind, text: `素材包「${e.title}」已经放到 ${relative(join(config.botsDir, botId), got.dir)}（${got.files} 个文件）。${e.assets.howto ?? ''}${e.license ? ` 许可：${e.license}。` : ''}` };
      }

      // mcp behind the product's OAuth service: the card is a login, not a key
      if (e.service) {
        const r = await bots.ops!.connect(botId, threadId, e.service, e.description);
        return { kind, text: r.text };
      }
      // mcp the bot connects to itself
      const m = e.mcp;
      if (!m) throw new Error(`「${e.slug}」没写怎么连`);
      const existing = store.data.integrations.find((i) => i.kind === 'mcp' && i.name === e.title);
      const grant = (id: string) => bots.ops!.grant(botId, id);
      if (existing) {
        await grant(existing.id);
        return { kind, text: existing.status === 'ok' ? `「${e.title}」已经连着了，工具就在你的列表里。` : `「${e.title}」连接已存在但状态是 ${existing.status}${existing.note ? `（${existing.note}）` : ''}。缺凭据就用 request_credentials 发卡。` };
      }
      // The server itself is a package: install it into the product's prefix so it does not download on every start
      // and does not vanish when the container is rebuilt.
      if (m.npm || m.pip) {
        const r = await depsReady({ npm: m.npm ? [m.npm] : [], pip: m.pip ? [m.pip] : [] }, e.slug);
        if (!r.ok) return { kind, text: r.pending ? `「${e.title}」的服务端${r.note}，接好了我会告诉你；先做别的。` : `装不了「${e.title}」：${r.note ?? ''}。告诉用户这台机器上装不上，或者换一条路。` };
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
          text: `${e.title} 要一个${m.env!.length > 1 ? '组' : ''}密钥才能用。填在卡上就行，我看不到内容，填完自动接。`,
          ts: Date.now(),
          card: { type: 'secrets', integrationId: added.id, title: `填一下 ${e.title} 的密钥`, fields: m.env!.map((f) => ({ ...f, secret: f.secret ?? true })), help: m.help },
        });
        return { kind, text: `「${e.title}」已经建好连接，凭据卡发到对话里了（要 ${m.env!.map((f) => f.label).join('、')}）。用户填完系统会自动接上并通知你；现在不要追问，先做别的或结束这一轮。` };
      }
      return { kind, text: added.status === 'ok' ? `「${e.title}」接好了，${added.tools ?? 0} 个工具已经在你的列表里。${m.tools ?? ''}` : `「${e.title}」连接建好了，状态 ${added.status}：${added.note ?? ''}` };
    },
    async createGroup(o) {
      const matter = router.createMatter({ title: o.title, summary: o.summary, memberIds: o.memberIds, leadId: o.leadId, quiet: !!o.task });
      if (o.task) {
        const from = store.bot(o.byBotId);
        const threadId = matterThread(matter.id);
        store.addMessage({ threadId, author: 'bot', botId: o.byBotId, text: o.task, ts: Date.now() });
        const line = `【群聊「${matter.title}」· 来自 @${from?.name ?? o.byBotId}】${o.task}`;
        // One task wakes one bot — whoever leads. Sending it to every member as a direct message had all of
        // them start the same work at once while the lead (the creator, by default) did nothing.
        const lead = matter.ownerBotId;
        for (const id of [matter.ownerBotId, ...matter.participantBotIds]) {
          if (id === lead) continue;
          void bots.send(id, { threadId, kind: 'group', text: `【群聊记录】${from?.name ?? o.byBotId} 在「${matter.title}」里说：${o.task}` });
        }
        void bots.send(
          lead,
          lead === o.byBotId
            ? { threadId, kind: 'system', text: `你在群「${matter.title}」里开了这件事：${o.task}\n你牵头，从现在起在群里推进：自己能做的直接做，要成员做的用 todo(create, assignee=名字, brief=交代清楚) 派下去再 @它。`, depth: 1 }
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
      kickDeps(`连接 ${i.name}`);
      const done = await mcp.connect(integ.id);
      return { id: integ.id, status: done?.status ?? 'error', note: done?.note, tools: done?.tools?.length };
    },
    async build(botId, spec) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('找不到这个 bot');
      const job = { id: `bld_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, aspect: spec.aspect, label: buildLabel(spec), since: Date.now(), skill: spec.skill };
      store.patchBot(botId, { building: [...(bot.building ?? []), job] });
      void runBuild({ store, skills: (id) => skills.of(id), runtime: bots.modelRuntime, model: bots.lightModel, onSkillWritten: (id) => bots.recycle(id), needs: needsFor }, botId, job, spec);
      return job;
    },
    async connect(botId, threadId, service, why) {
      const c = await connectors.resolve(service);
      if (!c && isChinesePlatform(service)) return { status: 'unknown', text: `「${service}」不在一键接入范围里（连接服务目前不覆盖飞书、钉钉、微信这些国内平台）。飞书作为 IM 渠道可以在「集成 › 渠道」里接；要读它的文档、日历，只能走「MCP 连接」技能的手动方式。如实告诉用户。` };
      if (!c) return { status: 'unknown', text: `连接服务里没有「${service}」这个平台。service 要用平台的英文 slug，常见的有：${POPULAR_TOOLKITS.join(', ')}；名字拿不准就换一个写法再试（如 google drive → googledrive，飞书 → lark）。确实不支持的，走「MCP 连接」技能的手动方式。` };
      if (!connectors.available(c)) return { status: 'unavailable', text: `${c.name} 的一键接入还没在这个产品里开通（产品方尚未配置连接服务）。如实告诉用户：这个功能还在开通中，暂时接不了，然后问他要不要先做别的；不要让他自己去找 token、App 密码或改邮箱。` };
      let existing = store.data.integrations.find((i) => i.connector === c.id);
      if (existing?.status !== 'ok') existing = (await connectors.reconcile(c)) ?? existing;
      const bot = store.bot(botId);
      if (existing?.status === 'ok' && bot) {
        if (!(bot.integrationIds ?? []).includes(existing.id)) {
          store.patchBot(botId, { integrationIds: [...(bot.integrationIds ?? []), existing.id] });
          await bots.refreshTools(botId);
        }
        return { status: 'connected', text: `${c.name} 早已连接（${existing.account ?? ''}），工具已在你的列表里，直接用。` };
      }
      let started: Awaited<ReturnType<typeof connectors.startUrl>>;
      try {
        started = await connectors.startUrl(c, { botId, threadId });
      } catch (e) {
        console.warn('[crew] connect failed:', (e as Error).message);
        return { status: 'unavailable', text: `${c.name} 的接入服务此刻没响应，暂时发不出授权卡。告诉用户「接入服务暂时不可用，稍后我再试」，然后问他要不要先做别的；不要让他自己去找 token、App 密码或改邮箱。` };
      }
      const { url, integration } = started;
      const msg = store.addMessage({ threadId, author: 'bot', botId, text: `我先把 ${c.name} 接上，点一下这张卡登录就行。`, ts: Date.now(), card: { type: 'connect', connector: c.id, name: c.name, blurb: why?.trim() ? `接上之后：${why.trim().replace(/[。.]$/, '')}` : c.blurb, url, integrationId: integration.id } });
      void msg;
      return { status: 'card', text: `授权卡已发到对话里。用户授权完成后系统会通知你，届时 ${c.name} 的工具会出现在你的列表里；现在不要追问，先说一句让他点卡片，然后继续别的事或结束这一轮。` };
    },
    removeIntegration(id) {
      const i = store.integration(id);
      void (i?.connector ? connectors.disconnect(id) : mcp.disconnect(id));
      store.removeIntegration(id);
    },
    vigil: () => vigil,
    async avatar(botId, value) {
      const bot = store.bot(botId);
      if (!bot) throw new Error('找不到这个 bot');
      const v = value.trim();
      if (!v) throw new Error('avatar 需要 value：regen / reset / 一句外观描述 / 图片文件路径');
      if (v === 'reset') {
        store.patchBot(bot.id, { avatarUrl: undefined, avatarLook: undefined });
        return `${bot.name} 的头像已换回默认图案。`;
      }
      // An image the bot made: only from its own directory, copied into the avatar store.
      if (v.startsWith('/') && /\.(png|jpe?g|webp)$/i.test(v)) {
        const botDir = join(config.botsDir, bot.id);
        const real = existsSync(v) ? realpathSync(v) : '';
        if (!real || !real.startsWith(realpathSync(botDir))) throw new Error('图片要在你自己的目录里（工作区），别处的文件不行');
        const ext = /\.jpe?g$/i.test(real) ? 'jpg' : /\.webp$/i.test(real) ? 'webp' : 'png';
        const dst = join(config.avatarsDir, `${bot.id}.${ext}`);
        copyFileSync(real, dst);
        store.patchBot(bot.id, { avatarUrl: `/avatars/${bot.id}.${ext}?v=${Date.now()}` });
        return `${bot.name} 的头像已换成你给的图片。`;
      }
      if (!avatars.available()) throw new Error('没有配置图像模型，画不了新头像；可以用 reset，或给一张你自己生成的图片');
      const look = v === 'regen' ? bot.avatarLook : v;
      const seed = `${bot.name}:${Date.now()}`;
      const next = store.patchBot(bot.id, { avatarSeed: seed, avatarUrl: undefined, avatarLook: look }) ?? bot;
      await ensureAvatar({ ...next, avatarUrl: undefined });
      const after = store.bot(bot.id);
      if (!after?.avatarUrl) throw new Error('图像模型这次没画出来，稍后再试一次');
      return `${bot.name} 的头像已重画${look ? `（外观：${look}）` : ''}。`;
    },
  } satisfies CrewOps;
}
