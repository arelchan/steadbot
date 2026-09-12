import { EventEmitter } from 'node:events';
import { rmSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mimeOf, fileUrl } from './util.ts';
import { config } from './config.ts';
import { makeCrewOps } from './crew-ops.ts';
import { sendJson } from './http.ts';
import { CrewStore, seedSnapshot, type StoreEvent } from './store.ts';
import { MemoryStore } from './memory.ts';
import { PendingBroker } from './broker.ts';
import { BotManager } from './bots.ts';
import { Router } from './router.ts';
import { Notifier } from './notifier.ts';
import { Scheduler } from './scheduler.ts';
import { AvatarService } from './avatar.ts';
import { FakeBrain } from './fake-brain.ts';
import { blankBot, inferBot, inferSkillDocs, inferSoul } from './infer-bot.ts';
import { SkillStore, SkillStores, migrateSharedSkills } from './skills.ts';
import { loadPrices, trimLedger } from './meter.ts';
import { KIND_LABEL, Library } from './library.ts';
import { pickupSkills } from './builder.ts';
import { ConnectorManager } from './connectors.ts';
import { AgentRunner, McpManager, seedIntegrations } from './integrations.ts';
import { ChannelManager, IMS, type Im } from './channels.ts';
import { DesktopManager } from './desktop.ts';
import { Upgrader } from './upgrade.ts';
import { restoreAll } from './tools.ts';
import { LoginDesk } from './login.ts';
import { WeixinPairing } from './weixin-pair.ts';
import { initDeps, kick as kickDeps, reconcile as reconcileDeps } from './deps.ts';
import * as everos from './everos.ts';
import { applyProviderKeys, modelsPage, saveModels, type ModelsPatch } from './models.ts';
import { versionLine } from './version.ts';
import { usageReport } from './usage.ts';
import { ledgerVersion } from './meter.ts';
import { Runtime } from './runtime.ts';
import { remoteInstall } from './remote-install.ts';
import { ensureSteward, STEWARD_FIRST_QUERY, STEWARD_SKILL_NAME, loadMachine, connectMachine, surveyMachine, probeMachine } from './machine.ts';
import { VigilManager } from './vigil.ts';
import { AgentHosts } from './host.ts';
import { HostClient } from './host-client.ts';
import { loadMovedTarget } from './runtime.ts';
import { createReadStream, statSync as statSyncFs } from 'node:fs';
import { Readable } from 'node:stream';
import type { Card, GrowthKind } from './types.ts';
import { BUILTIN_SKILL_NAMES, seedBuiltinSkills } from './builtin-skills.ts';
import { startServer } from './ws.ts';
import { botThread, parseThread, type Bot, type FileRef, type Integration, type ThreadId } from './types.ts';


/** An IM by any name a bot might use for it. */

/** This machine's public address, for platforms that want a trusted-IP list. */

async function main() {
  const store = new CrewStore(config.dataFile, seedSnapshot);
  const events = new EventEmitter();
  const memory = new MemoryStore(store, config.botsDir, config.sharedDir);
  const broker = new PendingBroker(store, config.askTimeoutMs);
  // The product's own manuals live in the shared agentDir; everything a bot mounts or writes lives in its own.
  const skills = new SkillStores(config.botsDir, new SkillStore(join(config.piAgentDir, 'skills')));
  const library = new Library(config.libraryDir);
  // Packages a bot installed for a skill live on the data volume, not in the image: put back whatever this machine
  // lost, then converge to what the manuals and connections that are here actually need (deps.ts). Both run in the
  // background: a machine that just arrived is missing everything, and nothing should wait for that.
  initDeps({ skills: () => skills.all(store.data.bots.map((b) => b.id)), integrations: () => store.data.integrations });
  // Memory: an EverOS sidecar on loopback (everos.ts). Also in the background, and also fine to be missing —
  // without it the bots keep the two plain-text lists they have always had.
  everos.initMemory({
    store,
    // A bot just had memories cut: if the engine has hardened one of its cases into a way of working,
    // that becomes a build (builder.ts). Nothing here waits for it.
    onExtract: (botId) =>
      void pickupSkills({ store, botsDir: config.botsDir, skillsOf: everos.skillsOf, build: async (id, spec) => bots.ops?.build(id, spec) }, botId),
  });
  void everos.startMemory().then((ok) => {
    // The two plain-text lists memory used to be: said to the engine once, as the user saying them, and gone.
    if (!ok) return;
    const legacy = memory.drain();
    if (!legacy.length) return;
    console.log(`[crew] 记忆：${legacy.length} 条旧清单里的事实交给引擎`);
    void everos.turnDone('legacy_lists', legacy.map((text, i) => ({ role: 'user' as const, senderId: everos.HUMAN_ID, text, ts: Date.now() + i }))).then(() => everos.flush('legacy_lists'));
  });
  void restoreAll()
    .catch((e: Error) => console.warn('[crew] tools restore failed:', e.message))
    .then(() => reconcileDeps('启动'));
  const mcp = new McpManager(store);
  const runner = new AgentRunner();
  const connectors = new ConnectorManager(store);
  const bots = new BotManager(store, broker, events, skills, mcp, runner, connectors);
  await seedIntegrations(store);
  // The bots share one computer here (a desktop + browser the user watches live), if this machine can host one.
  const desktops = new DesktopManager(store, mcp, (id) => bots.refreshTools(id));
  bots.desktops = desktops;
  // Who runs the bots: this instance, unless the home was moved to another server or another live server holds the lease.
  console.log(`[crew] version: ${versionLine()}`);
  const runtime = new Runtime();
  const mode = runtime.claim();
  const active = mode === 'active';
  if (active) await desktops.init();
  if (!active) console.warn(`[crew] runtime mode: ${mode}${runtime.movedTo ? ` (bots now at ${runtime.movedTo})` : ''} — not running bots here`);
  // 本机转接 (host.ts): a running runtime accepts the user's computer lending its agents; a signpost on the computer
  // is that lender, dialing the machine the bots moved to. Either way the runtime page shows the link's state.
  const hosts = new AgentHosts(store);
  runner.hosts = hosts;
  let hostClient: HostClient | undefined;
  runtime.extra = () => ({ agentHost: hosts.status(), hostLink: hostClient ? hostClient.state : runtime.mode === 'moved' ? 'no_token' : undefined, desktops: active ? desktops.capable : undefined, desktopsLive: active && desktops.capable ? desktops.liveScreen : undefined, desktopsNote: active && !desktops.capable ? desktops.capableNote : undefined, busy: active ? bots.busyNames() : undefined });
  const startHostLink = () => {
    const t = loadMovedTarget(runtime.movedTo);
    hostClient?.stop();
    hostClient = undefined;
    if (!t) {
      if (runtime.mode === 'moved') console.warn('[crew] no credentials for the machine the bots moved to; this computer cannot lend its agents');
      return;
    }
    hostClient = new HostClient(t);
    hostClient.onState = () => broadcastRuntime();
    hostClient.start();
  };
  // 成长动线是后加的：老 bot 从已有痕迹里补出一条（诞生、技能、进化、连接），之后的变化实时记录。
  for (const b of store.data.bots) {
    if (b.growth) continue;
    const docs = new Map(skills.of(b.id).list().map((d) => [d.name, d]));
    const evs: { ts: number; kind: GrowthKind; text: string }[] = [{ ts: b.createdAt, kind: 'born', text: '由你创建' }];
    for (const k of b.skills) {
      const d = docs.get(k);
      evs.push(d?.library ? { ts: d.updatedAt || b.createdAt, kind: 'library', text: `挂载技能库手册【${k}】` } : { ts: d?.updatedAt || b.createdAt, kind: 'skill', text: `沉淀技能【${k}】` });
    }
    for (const m of store.data.messages) if (m.botId === b.id && m.status === 'evolved') evs.push({ ts: m.ts, kind: 'evolved', text: `进化了 · ${m.text}` });
    for (const id of b.integrationIds ?? []) {
      const i = store.integration(id);
      if (i) evs.push({ ts: Math.max(i.createdAt, b.createdAt), kind: 'connection', text: `接入【${i.name}】` });
    }
    for (const r of b.routines) evs.push({ ts: b.createdAt, kind: 'routine', text: `新增例行任务【${r.title}】，${r.schedule}` });
    evs.sort((x, y) => x.ts - y.ts);
    store.patchBot(b.id, { growth: evs.map((e) => ({ id: Math.random().toString(36).slice(2, 10), ...e })) }, { growth: false });
  }
  // Connector tool lists are re-derived at every start (preferred reads first, write flags); live bots pick them up.
  for (const i of store.data.integrations.filter((x) => x.connector && x.status === 'ok')) {
    void connectors.verify(i.id).then(async () => {
      for (const b of store.data.bots) if ((b.integrationIds ?? []).includes(i.id)) await bots.refreshTools(b.id).catch(() => undefined);
    });
  }
  // 账本和价格表：价格表用来给那些响应里不带 cost 的调用（向量、图片）算钱，拉不到就按 0 记。
  trimLedger();
  void loadPrices();
  seedBuiltinSkills(skills.builtin);
  // Homes written before each bot had its own skills directory.
  if (active) migrateSharedSkills(skills, store.data.bots, [...BUILTIN_SKILL_NAMES, STEWARD_SKILL_NAME], join(config.piAgentDir, 'skills-shared-before'));
  if (active) resumeInterruptedTurns();
  // Reconnect MCP servers that were healthy last time (background).
  for (const i of store.data.integrations) if (i.kind === 'mcp' && i.status !== 'off') void mcp.connect(i.id);
  await bots.init(() => new FakeBrain(store));
  const router = new Router(store, bots, broker, events);
  const notifier = new Notifier(store);
  const scheduler = new Scheduler(store, bots);
  const vigil = new VigilManager(store, bots);
  const avatars = new AvatarService();
  if (active) {
    notifier.start();
    scheduler.start();
    vigil.start();
  }

  // Bots created before a generated avatar existed get one now (background).
  const setGenerating = (botId: string, part: 'identity' | 'avatar', on: boolean) => {
    const b = store.bot(botId);
    if (!b) return;
    const next = { ...b.generating, [part]: on };
    const any = Object.values(next).some(Boolean);
    store.patchBot(botId, { generating: any ? next : undefined });
  };
  const ensureAvatar = async (bot: Bot) => {
    if (bot.avatarUrl || !avatars.available()) {
      if (bot.generating?.avatar) setGenerating(bot.id, 'avatar', false);
      return;
    }
    setGenerating(bot.id, 'avatar', true);
    try {
      const url = await avatars.generate(bot, bot.avatarSeed ?? bot.id);
      if (!url.startsWith('data:')) store.patchBot(bot.id, { avatarUrl: url });
    } finally {
      setGenerating(bot.id, 'avatar', false);
    }
  };
  const ensureSkills = (bot: Bot) => skills.of(bot.id).ensure(bot.skills, (missing) => inferSkillDocs(bot, missing, bots.modelRuntime, bots.lightModel));
  /** Two passes over the pool — one on the brief, one on the finished role — as one list, best rank first. */
  const mergeCandidates = (...lists: { slug: string }[][]) => {
    const score = new Map<string, number>();
    const seen = new Map<string, { slug: string }>();
    for (const list of lists)
      list.forEach((e, i) => {
        score.set(e.slug, (score.get(e.slug) ?? 0) + 1 / (10 + i));
        seen.set(e.slug, e);
      });
    return [...score.entries()].sort((x, y) => y[1] - x[1]).map(([slug]) => seen.get(slug)!) as ReturnType<Library['list']>;
  };

  /** Copy library skills onto a bot; returns the display names actually added. */
  const mountLibrary = (botId: string, slugs: string[]) => {
    const added: string[] = [];
    for (const slug of slugs) {
      try {
        const { name } = library.mount(slug, skills.of(botId));
        const cur = store.bot(botId);
        if (!cur) break;
        if (!cur.skills.includes(name)) {
          store.patchBot(botId, { skills: [...cur.skills, name] }, { growth: false });
          store.grow(botId, 'library', `挂载技能库手册【${name}】`);
          added.push(name);
        }
      } catch (e) {
        console.warn('[crew] library mount failed:', (e as Error).message);
      }
    }
    // The session is built with the skills the bot had: a manual added while it is mid-turn is picked up by the next
    // one (recycle waits for this turn to settle).
    if (added.length) void bots.recycle(botId).catch((e: Error) => console.warn('[crew] recycle failed:', e.message));
    return added;
  };
  /**
   * What each bot has equipped from the pool lately. A manual it writes right after making something work for the
   * first time stands on those things, so the runtime — not the model — states them at the top of the manual, and a
   * bot that inherits the manual later gets the same things before it reaches step 1.
   */
  const equipLog: { botId: string; slug: string; at: number }[] = [];
  const needsFor = (botId: string) => {
    const cutoff = Date.now() - 2 * 3600_000;
    const slugs = [...new Set(equipLog.filter((e) => e.botId === botId && e.at > cutoff).map((e) => e.slug))].slice(-6);
    if (!slugs.length) return undefined;
    const line = slugs
      .map((slug) => {
        const e = library.get(slug);
        return `${slug}（${KIND_LABEL[e?.kind ?? 'skill']}${e && e.title !== slug ? `·${e.title}` : ''}）`;
      })
      .join('、');
    return { slugs, line: `${line}——缺哪个就 build(action=add, value=slug) 装上再动手` };
  };
  /** A bot that gains a manual gains what the manual stands on. */
  const followNeeds = async (botId: string, names: string[], threadId: ThreadId) => {
    for (const name of names) {
      for (const slug of skills.of(botId).get(name)?.needs ?? []) {
        try {
          await bots.ops!.equip(botId, slug, threadId);
        } catch (e) {
          console.warn(`[crew] 手册「${name}」要的「${slug}」没装上：`, (e as Error).message);
        }
      }
    }
  };
  // 助理是产品自带的：第一次启动就把它建出来，置顶。头像在下面那个循环里一起生成。
  if (active) ensureSteward(store);
  for (const b of store.data.bots) {
    // A build interrupted by a restart is gone; don't leave the UI saying building… forever.
    if (b.building?.length) store.patchBot(b.id, { building: [] });
    // Older records baked in the origin of the server that generated the avatar (http://localhost:5200/avatars/…),
    // which breaks after a move and never carried the token. Store the path only; the client resolves it.
    if (b.avatarUrl && /^https?:\/\/[^/]+\/avatars\//.test(b.avatarUrl)) store.patchBot(b.id, { avatarUrl: b.avatarUrl.replace(/^https?:\/\/[^/]+/, '') }, { growth: false });
    void ensureAvatar(b);
  }
  // Skill docs / personas for bots that predate those fields, one bot at a time (cheap model, background).
  void (async () => {
    for (const b of store.data.bots) {
      if (!b.soul && !b.generating?.identity) {
        const soul = await inferSoul(b, bots.modelRuntime, bots.lightModel);
        if (soul && !store.bot(b.id)?.soul) store.patchBot(b.id, { soul });
      }
    }
    // A skill name with no manual behind it is dropped, not written for: bots carry only manuals somebody wrote.
    for (const b of store.data.bots) {
      const have = b.skills.filter((n) => skills.of(b.id).has(n) || skills.builtin.has(n));
      if (have.length !== b.skills.length) store.patchBot(b.id, { skills: have }, { growth: false });
    }
  })();

  // IM accounts: each bot is its own bot on Feishu / Telegram / Slack / 企业微信 (credentials in config.json, entered on a card).
  const channels = new ChannelManager(store, router);
  if (active) await channels.startAll();
  store.on('change', (e: StoreEvent) => {
    if (e.type !== 'message' || e.message.author !== 'bot') return;
    const pending = e.message.card && 'pendingId' in e.message.card ? store.pending(e.message.card.pendingId) : undefined;
    void channels.deliver(e.message, pending);
  });

  /**
   * The one way bots come into being.
   *
   * Two things happen at once. The identity is written by the model from the situation the bot is born into
   * (infer-bot.ts) and nothing else can start before it, because the bot's first turn runs on it. Everything it
   * carries — manuals from the pool, the services its job needs, what those manuals stand on — is found and equipped
   * alongside that first turn, not in front of it: the pool search starts on the brief while the identity call is
   * still in flight, and `recycle` waits for the turn to settle before the session picks the new manuals up. What the
   * user waits for is one model call, not the whole outfitting.
   */
  async function createBotFromBrief(
    brief: string,
    opts: { userMessageId?: string; name?: string; announce?: (b: Bot) => void; task?: string; fromBotId?: string },
  ): Promise<Bot> {
    const names = store.data.bots.map((b) => b.name);
    const base = blankBot(brief, names);
    const bot = store.addBot({ ...base, ...(opts.name ? { name: opts.name } : {}), generating: { identity: true, avatar: avatars.available() } });
    opts.announce?.(bot);
    const threadId = botThread(bot.id);
    const first = opts.task ?? brief;
    const from = opts.fromBotId ? store.bot(opts.fromBotId) : undefined;
    // The birth card heads the conversation; the sentence that created the bot follows it.
    const intro = store.addMessage({ threadId, author: 'system', botId: bot.id, text: bot.role, ts: Date.now() - 1, status: 'born' });
    store.grow(bot.id, 'born', from ? `由 ${from.name} 创建` : '由你创建', bot.createdAt);
    const userMsg = from
      ? undefined
      : store.addMessage({ id: opts.userMessageId, threadId, author: 'user', text: brief, ts: Date.now(), via: 'app' });
    if (from) store.addMessage({ threadId, author: 'system', text: `由 ${from.name} 创建。${opts.task ? '' : '还没有交给它任务。'}`, ts: Date.now() });
    store.typing(threadId, bot.id, true);
    // Whatever happens to the identity call, the bot answers exactly once, and it answers as soon as it can.
    let started = false;
    const startFirstTurn = () => {
      if (started) return;
      started = true;
      if (from && opts.task) void bots.send(bot.id, { threadId, kind: 'bot', text: `【来自 @${from.name}】${opts.task}`, fromBotId: from.id, depth: 1 });
      else if (!from) void bots.send(bot.id, { threadId, kind: 'user', text: first, via: 'app', userMessageId: userMsg?.id });
      else store.typing(threadId, bot.id, false);
    };
    void (async () => {
      // No model in this one: it runs on the brief while the identity is being written.
      const early = library.candidates(brief, 16).catch(() => []);
      let refined = bot;
      try {
        const identity = inferBot(
          brief,
          {
            botId: bot.id,
            existing: store.data.bots.filter((b) => b.id !== bot.id).map((b) => ({ name: b.name, tagline: b.tagline || b.role.split(/[。，]/)[0] })),
            profile: everos.profileLines(),
            integrations: store.data.integrations.filter((i) => i.status === 'ok' && i.kind !== 'channel').map((i) => i.name),
          },
          bots.modelRuntime,
          bots.lightModel,
        );
        // A light model having a bad minute must not hold the first reply hostage: past this the bot answers as
        // itself-so-far, and the written identity lands underneath it whenever it arrives.
        let meta = await Promise.race([identity, new Promise<undefined>((r) => setTimeout(() => r(undefined), 20_000))]);
        if (!meta) {
          startFirstTurn();
          meta = await identity;
        }
        refined = store.patchBot(bot.id, { ...(opts.name ? {} : { name: meta.name }), glyph: meta.glyph, tagline: meta.tagline, role: meta.role, soul: meta.soul, skills: [] }) ?? bot;
        setGenerating(bot.id, 'identity', false);
        store.grow(bot.id, 'identity', `生成了名字、职责和人设，叫【${refined.name}】`);
        store.patchMessage(intro.id, { text: refined.role });
        void ensureAvatar(store.bot(bot.id) ?? refined);
        // The identity is in place, so the bot can work. Everything below lands around that first turn.
        startFirstTurn();

        const query = [brief, refined.role, meta.hints.join(' ')].filter(Boolean).join(' ');
        const cands = mergeCandidates(await early, await library.candidates(query, 16).catch(() => []));
        const picks = await library.pickForBot({ ...refined, botId: bot.id }, brief, cands, bots.modelRuntime, bots.lightModel);
        const mounted = mountLibrary(bot.id, picks.mount);
        console.log(`[crew] ${refined.name} mounted from library: ${mounted.join('、') || '（没有对上的）'}（候选 ${cands.length}）`);
        // Connections the role needs are part of the build too: reuse an existing authorization, else hand the user a card now.
        for (const service of picks.connections) {
          try {
            const r = await bots.ops!.connect(bot.id, threadId, service, `${refined.name}要用它来${refined.tagline || '干活'}`);
            console.log(`[crew] ${refined.name} connection ${service}: ${r.status}`);
            if (r.status === 'connected') store.addMessage({ threadId, author: 'system', text: `已接入 ${service}（复用你已有的授权）`, ts: Date.now() });
          } catch (e) {
            console.warn('[crew] birth connect failed:', (e as Error).message);
          }
        }
        // Inheriting a manual written by another bot means inheriting what it was written on top of.
        await followNeeds(bot.id, (store.bot(bot.id) ?? refined).skills, threadId);
      } catch (e) {
        console.warn('[crew] birth failed:', (e as Error).message);
        setGenerating(bot.id, 'identity', false);
      } finally {
        startFirstTurn();
      }
    })();
    return bot;
  }

  /**
   * A restart (deploy, hot reload) kills whatever turn a bot was in the middle of. Look at each bot's latest session:
   * if it ends on a pending tool call / tool result, or on an unanswered user message, tell the bot to pick up where
   * it left off and leave a small notice in the thread so the user knows why it went quiet.
   */
  function resumeInterruptedTurns() {
    const MAX_AGE = 24 * 60 * 60 * 1000;
    for (const bot of store.data.bots) {
      try {
        const dir = join(config.botsDir, bot.id, 'sessions');
        if (!existsSync(dir)) continue;
        const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
        if (!files.length || Date.now() - files[0].t > MAX_AGE) continue;
        const lines = readFileSync(join(dir, files[0].f), 'utf8').trim().split('\n');
        let last: { role?: string; stopReason?: string; content?: unknown } | undefined;
        for (let i = lines.length - 1; i >= 0 && !last; i -= 1) {
          try {
            const e = JSON.parse(lines[i]) as { type?: string; message?: { role?: string; stopReason?: string; content?: unknown } };
            if (e.type === 'message' && e.message) last = e.message;
          } catch {
            /* skip */
          }
        }
        if (!last) continue;
        const midTool = last.role === 'toolResult' || (last.role === 'assistant' && last.stopReason === 'toolUse');
        const unanswered = last.role === 'user';
        if (!midTool && !unanswered) continue;
        const threadId = botThread(bot.id);
        store.addMessage({ threadId, author: 'system', text: `服务刚重启，${bot.name} 上一轮被打断，正在接着做。`, ts: Date.now() });
        void bots.send(bot.id, {
          threadId,
          kind: 'system',
          text: midTool
            ? '服务刚重启，你上一轮在调用工具时被打断，工具结果可能没拿到。看一眼上文，接着把那件事做完；已经做过的步骤不要重做，用户不需要解释重启。'
            : '服务刚重启，用户上一条消息还没有回复。看一眼上文，直接回复它。',
        });
        console.log(`[crew] resumed interrupted turn for ${bot.name} (${midTool ? 'mid-tool' : 'unanswered'})`);
      } catch (e) {
        console.warn(`[crew] resume check failed for ${bot.id}:`, (e as Error).message);
      }
    }
  }

  // Memory consolidations for one list run strictly one after another; two in flight would clobber each other.
  connectors.on('connected', async ({ integration, state }: { integration: Integration; state: { botId: string; threadId: ThreadId } }) => {
    const bot = store.bot(state.botId);
    if (bot && !(bot.integrationIds ?? []).includes(integration.id)) store.patchBot(bot.id, { integrationIds: [...(bot.integrationIds ?? []), integration.id] });
    await bots.refreshTools(state.botId);
    for (const m of store.data.messages) if (m.card?.type === 'connect' && m.card.integrationId === integration.id && !m.card.done) store.patchMessage(m.id, { card: { ...m.card, done: true, account: integration.account } });
    store.addMessage({ threadId: state.threadId, author: 'system', text: `${integration.name} 已连接${integration.account ? `（${integration.account}）` : ''}`, ts: Date.now() });
    void bots.send(state.botId, { threadId: state.threadId, kind: 'system', text: `用户已完成 ${integration.name} 的授权${integration.account ? `（${integration.account}）` : ''}，它的工具现在在你的工具列表里。接着办刚才的事，不用再确认连接。` });
  });

  connectors.on('failed', ({ integration, state, reason, kind, name }: { integration?: Integration; state: { botId: string; threadId: ThreadId; integrationId: string }; reason: string; kind: 'failed' | 'expired'; name: string }) => {
    for (const m of store.data.messages) if (m.card?.type === 'connect' && m.card.integrationId === state.integrationId && !m.card.done) store.patchMessage(m.id, { card: { ...m.card, ...(kind === 'expired' ? { expired: true } : { failed: reason }) } });
    if (kind === 'expired') return; // nothing happened for 15 minutes: mark the card, stay quiet
    store.addMessage({ threadId: state.threadId, author: 'system', text: `${name} 授权没有完成：${reason}`, ts: Date.now() });
    void bots.send(state.botId, { threadId: state.threadId, kind: 'system', text: `用户没有完成 ${integration?.name ?? name} 的授权（${reason}）。用一句话告诉他没接上，问他要不要再试一次；他说要，就再调 connect 发一张新卡。不要猜原因、不要让他去找密码或 token。` });
  });

  bots.ops = makeCrewOps({ store, bots, mcp, connectors, desktops, runtime, skills, library, router, vigil, avatars, channels, ensureAvatar, mountLibrary, needsFor, equipLog, logins: () => logins, createBotFromBrief });

  /** Quiesce everything that acts on the home (bots, schedules, IM bridges) so it can be packed or replaced. */
  let running = active;
  async function stopRunning() {
    if (!running) return;
    running = false;
    scheduler.stop();
    vigil.stop();
    notifier.stop();
    channels.stopAll();
    await desktops.stopAll();
    runner.dispose();
    await bots.dispose();
  }
  async function resumeRunning() {
    if (running) return;
    running = true;
    await desktops.init();
    notifier.start();
    scheduler.start();
    vigil.start();
    await channels.startAll();
  }
  const broadcastRuntime = () => server.broadcast({ type: 'runtime', runtime: runtime.info() });
  hosts.onChange = () => broadcastRuntime();

  /** Push this home to another server (paired by code), then stand down here. Resolves with the bot count the other side reports. */
  async function migrateHomeTo(target: string, token: string, force: boolean, onProgress: (sent: number, total: number) => void, name?: string): Promise<number> {
    if (runtime.mode !== 'active') throw new Error('这台机器上没有在跑的 bot');
    const probe = await fetch(`${target}/runtime/info`, { headers: { authorization: `Bearer ${token}` } }).catch(() => undefined);
    if (!probe?.ok) throw new Error(probe?.status === 401 ? '连接码不对，对方拒绝了' : '连不上那台机器，检查地址和网络');
    await stopRunning();
    const archive = await runtime.exportArchive();
    let r: Response;
    try {
      // Stream the archive so the client can show how far the upload got: to a far machine this is the slow part.
      const total = statSyncFs(archive).size;
      let sent = 0;
      let lastTick = 0;
      onProgress(0, total);
      const body = Readable.toWeb(
        createReadStream(archive, { highWaterMark: 64 * 1024 }).on('data', (c: Buffer | string) => {
          sent += c.length;
          if (Date.now() - lastTick > 500 || sent === total) {
            lastTick = Date.now();
            onProgress(sent, total);
          }
        }),
      ) as ReadableStream;
      r = await fetch(`${target}/migrate/import${force ? '?force=1' : ''}`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/gzip', 'content-length': String(total) }, body, duplex: 'half' } as RequestInit);
    } catch (e) {
      // Nothing arrived: resume here.
      await resumeRunning();
      throw new Error(`没送到那台机器（${(e as Error).message}）`);
    } finally {
      rmSync(archive, { force: true });
    }
    const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string; bots?: number };
    if (!r.ok || !body.ok) {
      await resumeRunning();
      throw new Error(body.error ?? `对方没接收（${r.status}）`);
    }
    runtime.markMoved(target, token, name);
    broadcastRuntime();
    // The other side restarts on the new state; wait for it so a client that follows lands on a live server, not a reconnect screen.
    for (let i = 0; i < 60; i++) {
      const ok = await fetch(`${target}/runtime/info`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) })
        .then(async (x) => x.ok && ((await x.json()) as { mode?: string }).mode === 'active')
        .catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    // From now on this computer lends its agents to the bots over there.
    startHostLink();
    return body.bots ?? 0;
  }

  // 升级：this computer's code is the version of record; the upgrader makes the runtime match it (upgrade.ts).
  let machineBuild: string | undefined;
  const refreshMachineBuild = async () => {
    if (runtime.mode !== 'moved') return;
    const m = loadMachine();
    if (!m?.url || !m.token) return;
    const p = await probeMachine({ url: m.url, token: m.token });
    const next = p.reachable ? p.build : undefined;
    if (next !== machineBuild) {
      machineBuild = next;
      broadcastUpgrade();
    }
  };
  // Login walls the bot hits on the shared computer come to the conversation instead (login.ts).
  const logins = new LoginDesk(store, desktops, (botId, text) => router.tellBot(botId, text));
  // A login card points at a live page through an ask that only exists in memory. After a restart there is nothing
  // behind it, so the card would sit there forever showing a broken image: close them out as soon as we come up.
  for (const m of store.data.messages) {
    if (m.card?.type === 'login' && !m.card.done) store.patchMessage(m.id, { card: { ...m.card, done: true, ok: false, note: '已失效（服务重启过）' } });
  }

  // 微信 is joined by scanning, not by filling a card: the pairing desk posts the code and hands the token that
  // comes back to the channel manager, which starts the bridge like any other.
  const weixinPairing = new WeixinPairing(
    store,
    (botId, values) => channels.onSecrets(botId, 'weixin', values),
    (botId, text) => router.tellBot(botId, text),
  );
  channels.pairWeixin = (botId, threadId) => weixinPairing.begin(botId, threadId);

  const upgrader = new Upgrader(runtime, () => machineBuild, () => process.exit(75), () => (active ? bots.busyNames() : []));
  void upgrader.refreshLatest();
  setInterval(() => void upgrader.refreshLatest().then(broadcastUpgrade), 10 * 60_000).unref();
  const broadcastUpgrade = () => server?.broadcast({ type: 'upgrade_status', status: upgrader.status() });
  // Spending changes with every call a bot makes; the 用量 page is pushed when it has actually moved, at most
  // once every half minute, so an open window is current without anyone asking for it.
  let sentLedger = ledgerVersion();
  setInterval(() => {
    if (ledgerVersion() === sentLedger) return;
    sentLedger = ledgerVersion();
    server?.broadcast({ type: 'usage', report: usageReport(store, 30) });
  }, 30_000).unref();
  upgrader.on('log', (line: string) => server?.broadcast({ type: 'upgrade_log', line }));

  const server = startServer(store, config.port, config.avatarsDir, {
    snapshotMode: () => bots.mode,
    snapshotExtra: () => ({ runtime: runtime.info(), skills: skills.list(store.data.bots.map((b) => b.id)), library: library.list(), typing: store.typingSnapshot(), upgrade: upgrader.status() }),
    // 设置 › 模型 and 设置 › 用量 used to be a request each, made when the window was opened. They are small and
    // the socket is already up, so they arrive with the connection instead — and are pushed again when they change.
    afterSnapshot: (reply) => {
      reply({ type: 'models', page: modelsPage(bots.modelRuntime) });
      reply({ type: 'usage', report: usageReport(store, 30) });
    },
    // Only the runtime that runs the bots borrows agents; a signpost has no bots to lend them to.
    onHost: active ? (socket) => hosts.attach(socket) : undefined,
    onVnc: active ? (req, socket, head) => desktops.proxy(req, socket, head) : undefined,
    http: async (req, res) => {
      const url = new URL(req.url ?? '/', config.publicUrl);
      {
        // A still of the computer's screen, for the card (desktop.ts). 404 when the computer is off.
        if (url.pathname === '/screen.jpg') {
          const w = Math.min(1440, Math.max(160, Number(url.searchParams.get('w') ?? 640)));
          // `bot` asks for what that bot is looking at — its own tab. Without one, or when it is not on the
          // computer, the answer is the machine itself, which is what the card showed before any of this.
          const who = url.searchParams.get('bot');
          const p = (who ? await desktops.botShot(who, w).catch(() => undefined) : undefined) ?? desktops.snapshot(w);
          if (!p) {
            res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end('{"error":"off"}');
            return true;
          }
          try {
            const jpeg = await p;
            res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
            res.end(jpeg);
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({ error: (e as Error).message.slice(0, 160) }));
          }
          return true;
        }
      }
      {
        const m = /^\/login\/([a-f0-9]{12})\.png$/.exec(url.pathname);
        if (m) {
          try {
            // Two kinds of card share this route: a crop of the live page (login.ts) and a 微信 pairing code.
            const png = weixinPairing.png(m[1]) ?? (await logins.shot(m[1]));
            res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
            res.end(png);
          } catch (e) {
            res.writeHead(404, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
            res.end(JSON.stringify({ error: (e as Error).message.slice(0, 120) }));
          }
          return true;
        }
      }
      if (url.pathname.startsWith('/memory/')) {
        // The memory page (MemoryView): four kinds the engine keeps, read straight from it; the few writes there are
        // (edit a profile line, add a fact, promote or adopt a skill, say "this is wrong") all go back through it.
        const json = (code: number, body: unknown) => sendJson(res, code, body);
        const readBody = async <T,>(): Promise<T> => {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T;
        };
        const botIds = () => {
          const one = url.searchParams.get('bot');
          return one ? [one] : store.data.bots.map((b) => b.id);
        };
        const p = url.pathname;
        if (p === '/memory/profile' && req.method === 'GET') return json(200, { alive: everos.alive(), profile: everos.profileDoc() ?? null });
        if (p === '/memory/profile' && req.method === 'POST') {
          const b = await readBody<{ kind?: 'explicit' | 'trait'; index?: number; text?: string | null }>();
          const ok = b.kind && typeof b.index === 'number' ? await everos.editProfile(b.kind, b.index, b.text ?? null) : false;
          return json(ok ? 200 : 409, { ok });
        }
        if (p === '/memory/fact' && req.method === 'POST') return json(200, { ok: await everos.addFact((await readBody<{ text?: string }>()).text ?? '') });
        if (p === '/memory/correct' && req.method === 'POST') return json(200, { ok: await everos.correct((await readBody<{ text?: string }>()).text ?? '') });
        if (p === '/memory/knowledge' && req.method === 'GET') return json(200, { alive: everos.alive(), ...(await everos.kDocs()) });
        if (p === '/memory/knowledge/doc') return json(200, { doc: (await everos.kDoc(url.searchParams.get('id') ?? '')) ?? null });
        if (p === '/memory/knowledge/topic') return json(200, { topic: (await everos.kTopic(url.searchParams.get('id') ?? '')) ?? null });
        if (p === '/memory/knowledge/search') return json(200, { hits: await everos.kSearch(url.searchParams.get('q') ?? '', 20) });
        if (p === '/memory/knowledge/remove' && req.method === 'POST') return json(200, { ok: await everos.kRemove((await readBody<{ docId?: string }>()).docId ?? '') });
        if (p === '/memory/knowledge/add' && req.method === 'POST') {
          // The file comes up as raw bytes with its name in the query, the way an attachment upload does.
          // Splitting a document takes a minute or more, so the client is told it started, not that it finished.
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          const name = decodeURIComponent(url.searchParams.get('name') ?? 'file');
          const title = decodeURIComponent(url.searchParams.get('title') ?? name).replace(/\.[a-z0-9]+$/i, '');
          void everos
            .kAdd(name, Buffer.concat(chunks), title)
            .then((r) => console.log(r ? `[crew] 知识：「${title}」切成 ${r.topics} 个主题` : `[crew] 知识：「${title}」没读进去`))
            .catch((e: Error) => console.warn('[crew] 知识：', e.message));
          return json(202, { started: true });
        }
        if (p === '/memory/episodes') return json(200, await everos.episodes(url.searchParams.get('q') ?? '', Number(url.searchParams.get('page') ?? 1)));
        if (p === '/memory/cases') return json(200, { items: await everos.cases(botIds()) });
        if (p === '/memory/skills') return json(200, { items: await everos.skills(botIds()), crew: await everos.crewSkills() });
        if (p === '/memory/promote' && req.method === 'POST') {
          // The user deciding that one bot's way of working is now everyone's. Sharing is this act and nothing else.
          const b = await readBody<{ botId?: string; name?: string }>();
          const bot = b.botId ? store.bot(b.botId) : undefined;
          const found = bot ? (await everos.skills([bot.id])).find((x) => x.name === b.name) : undefined;
          return json(200, { ok: found && bot ? await everos.promote(found.content || found.description, bot.name) : false });
        }
        if (p === '/memory/adopt' && req.method === 'POST') {
          // "Write this into how you work": the same build a user's correction takes, so it can be seen and reverted.
          const b = await readBody<{ botId?: string; name?: string }>();
          const bot = b.botId ? store.bot(b.botId) : undefined;
          const found = bot ? (await everos.skills([bot.id])).find((x) => x.name === b.name) : undefined;
          if (!found || !bot || !bots.ops) return json(409, { ok: false });
          await bots.ops.build(bot.id, { aspect: 'instructions', trigger: `用户把记忆里的做法「${found.name}」定为你的工作方式`, change: `把这条做法写进你的工作方式，用你自己的话：\n${(found.content || found.description).slice(0, 1500)}` });
          return json(200, { ok: true });
        }
        return json(404, { error: 'not found' });
      }
      if (url.pathname === '/models') {
        // 设置 › 模型. GET draws the page; POST writes what changed and makes it true without a restart.
        const json = (code: number, body: unknown) => sendJson(res, code, body);
        // The row the user has just moved to another provider asks for that provider's catalog by name; the rest
        // of the page carries only the lists its eight rows are already on.
        const want = url.searchParams.getAll('for').filter(Boolean);
        if (req.method === 'POST') {
          const chunks: Buffer[] = [];
          await new Promise<void>((resolve, reject) => {
            req.on('data', (c: Buffer) => chunks.push(c));
            req.on('end', resolve);
            req.on('error', reject);
          });
          const touched = saveModels(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as ModelsPatch);
          if (touched.keys) await applyProviderKeys(bots.modelRuntime);
          if (touched.keys || touched.models) {
            bots.pickModels(() => new FakeBrain(store));
            // Every bot builds its session from the models above; the ones idle right now rebuild on their next
            // message, and the ones mid-turn finish on the old model first (recycle waits for them).
            for (const b of store.data.bots) void bots.recycle(b.id);
          }
          // The memory engine reads its four models and its key from the environment it was spawned with.
          if (touched.memory && everos.alive()) {
            everos.stopMemory();
            void everos.startMemory();
          }
          const page = modelsPage(bots.modelRuntime, want);
          // Every window showing this page gets the change, not just the one that made it.
          if (touched.keys || touched.models) server?.broadcast({ type: 'models', page: modelsPage(bots.modelRuntime) });
          return json(200, page);
        }
        return json(200, modelsPage(bots.modelRuntime, want));
      }
      if (url.pathname === '/usage') {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(usageReport(store, Number(url.searchParams.get('days') ?? 30))));
        return true;
      }
      if (url.pathname === '/upgrade/status') {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(upgrader.status()));
        return true;
      }
      if (url.pathname === '/runtime/target') {
        // Where the bots actually are, for an App whose stored pairing went stale (a reinstall regenerates the
        // token). Loopback only: on a machine with a token this would be handing out that machine's credentials.
        if (config.authToken) {
          res.writeHead(404, { 'content-type': 'application/json' });
          res.end('{}');
          return true;
        }
        const t = runtime.mode === 'moved' ? loadMovedTarget(runtime.movedTo) : undefined;
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(t ? { url: t.url, token: t.token, name: t.name } : { local: true }));
        return true;
      }
      if (url.pathname === '/runtime/info') {
        res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
        res.end(JSON.stringify(runtime.info()));
        return true;
      }
      if (url.pathname === '/migrate/export' && req.method === 'GET') {
        // Another server (the one the user is moving the bots to) pulls this home. After it is sent, the bots live there.
        const to = url.searchParams.get('to') ?? '';
        await stopRunning();
        const archive = await runtime.exportArchive();
        res.writeHead(200, { 'content-type': 'application/gzip', 'content-length': statSyncFs(archive).size });
        createReadStream(archive).pipe(res).on('finish', () => {
          rmSync(archive, { force: true });
          runtime.markMoved(to);
          broadcastRuntime();
          startHostLink();
        });
        return true;
      }
      if (url.pathname === '/migrate/import' && req.method === 'POST') {
        // A home pushed from another server. On success this process exits with 75 so the supervisor restarts it on the new state.
        const force = url.searchParams.get('force') === '1';
        const tmp = join(config.home, `.import-${Date.now()}.tar.gz`);
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve, reject) => {
          req.on('data', (c: Buffer) => chunks.push(c));
          req.on('end', resolve);
          req.on('error', reject);
        });
        writeFileSync(tmp, Buffer.concat(chunks));
        try {
          await stopRunning();
          const r = await Runtime.importArchive(tmp, { force });
          res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: true, bots: r.bots }));
          console.log(`[crew] home imported (${r.bots} bots); restarting to load it`);
          setTimeout(() => process.exit(75), 400);
        } catch (e) {
          res.writeHead(409, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
          res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        } finally {
          rmSync(tmp, { force: true });
        }
        return true;
      }
      if (url.pathname.startsWith('/upload/') && req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type' });
        res.end();
        return true;
      }
      if (url.pathname.startsWith('/upload/') && req.method === 'POST') {
        // POST /upload/<threadId>?name=<file name>, raw body: a file attached in the composer. It lands in the bot's
        // workspace/_in (a group's files go to the lead bot) and comes back as the FileRef the message will carry.
        const threadId = decodeURIComponent(url.pathname.slice('/upload/'.length)) as ThreadId;
        const { kind, id } = parseThread(threadId);
        const botId = kind === 'bot' ? id : store.matter(id)?.ownerBotId;
        const bot = botId ? store.bot(botId) : undefined;
        const json = (code: number, body: unknown) => sendJson(res, code, body);
        if (!bot) return json(404, { error: '会话不存在' });
        const rawName = (url.searchParams.get('name') ?? 'file').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
        const chunks: Buffer[] = [];
        let size = 0;
        const tooBig = await new Promise<boolean>((resolve) => {
          req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > 50 * 1024 * 1024) {
              resolve(true);
              req.destroy();
            } else chunks.push(c);
          });
          req.on('end', () => resolve(false));
          req.on('error', () => resolve(true));
        });
        if (tooBig) return json(413, { error: '文件太大（上限 50 MB）' });
        const dir = join(config.botsDir, bot.id, 'workspace', '_in');
        mkdirSync(dir, { recursive: true });
        let name = rawName;
        for (let n = 2; existsSync(join(dir, name)); n++) name = rawName.replace(/(\.[^.]*)?$/, (ext) => `-${n}${ext}`);
        const file = join(dir, name);
        writeFileSync(file, Buffer.concat(chunks));
        const ref: FileRef = { name, path: `workspace/_in/${name}`, botId: bot.id, size, mime: mimeOf(file), url: fileUrl(bot.id, `workspace/_in/${name}`) };
        return json(200, ref);
      }
      if (url.pathname === '/oauth/google/start') {
        const to = connectors.authRedirect(url.searchParams.get('state') ?? '');
        res.writeHead(to ? 302 : 400, to ? { Location: to } : { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(to ? undefined : '这个授权链接已失效，请让 bot 重新发一张卡片。');
        return true;
      }
      if (url.pathname === '/oauth/composio/callback') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const ok = url.searchParams.get('status') !== 'failed';
        if (!ok) connectors.fail(url.searchParams.get('state') ?? '', '用户在登录页取消或平台拒绝了授权');
        const page = (title: string, sub: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#2c241c;background:#fbfaf7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:22px;font-weight:600">${title}</div><div style="color:#7a6f64;margin-top:8px">${sub}</div></div><script>setTimeout(()=>window.close(),1800)</script></body>`;
        res.end(ok ? page('已连接', '这个窗口可以关了，回到应用继续。') : page('没有完成授权', '回到应用，让 bot 再发一张卡即可。'));
        return true;
      }
      if (url.pathname === '/oauth/google/callback') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const page = (title: string, sub: string) => `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px/1.6 -apple-system,system-ui,sans-serif;color:#2c241c;background:#fbfaf7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><div style="font-size:22px;font-weight:600">${title}</div><div style="color:#7a6f64;margin-top:8px">${sub}</div></div><script>setTimeout(()=>window.close(),1500)</script></body>`;
        const err = url.searchParams.get('error');
        if (err) {
          connectors.fail(url.searchParams.get('state') ?? '', `Google 返回 ${err}`);
          res.end(page('没有完成授权', `Google 返回：${err}。回到应用，让 bot 再发一张卡即可。`));
          return true;
        }
        try {
          const { integration } = await connectors.handleCallback(url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? '');
          res.end(page(`${integration.name} 已连接`, `${integration.account ?? ''} · 这个窗口可以关了，回到应用继续。`));
        } catch (e) {
          res.end(page('连接没成功', (e as Error).message));
        }
        return true;
      }
      return channels.handleHttp(req, res);
    },
    onClient: async (msg, reply) => {
      // A signpost still answers about versions: the code lives on this computer, so upgrading the machine the bots
      // moved to is driven from here (upgrade.ts).
      if (runtime.mode !== 'active' && !['migrate_from', 'upgrade'].includes(msg.type))
        throw new Error(runtime.mode === 'moved' ? `bot 已搬到 ${runtime.movedTo ?? '另一台机器'}，这里只是路牌` : '另一台机器正在运行这些 bot');
      switch (msg.type) {
        case 'user_message':
          router.onUserMessage(msg.threadId, msg.text, msg.via ?? 'app', msg.id, msg.files);
          break;
        case 'draft_message': {
          const bot = await createBotFromBrief(msg.text, { userMessageId: msg.id, announce: (b) => reply({ type: 'bot_created', bot: b, draftId: msg.id }) });
          void bot;
          break;
        }
        case 'pending_choice':
          router.onPendingChoice(msg.pendingId, msg.optionId);
          break;
        case 'patch_bot': {
          const before = store.bot(msg.id);
          const bot = store.patchBot(msg.id, msg.patch);
          if (bot && before && msg.patch.avatarSeed && msg.patch.avatarSeed !== before.avatarSeed && !msg.patch.avatarUrl) void ensureAvatar({ ...bot, avatarUrl: undefined });
          if (bot && msg.patch.skills) void ensureSkills(bot);
          if (bot && msg.patch.integrationIds) void bots.refreshTools(bot.id);
          break;
        }
        case 'drop_event': {
          store.dropEvent(msg.id);
          break;
        }
        case 'run_routine': {
          if (!scheduler.runNow(msg.botId, msg.routineId)) throw new Error('这条例行任务不在了');
          break;
        }
        case 'remote_install': {
          // Only the user's own machine does this (loopback, no token): it holds the code and the ssh session.
          if (config.authToken) throw new Error('只能从本机发起安装');
          try {
            const r = await remoteInstall({ host: msg.host, user: msg.user, password: msg.password, domain: msg.domain }, (line) => reply({ type: 'remote_install_log', line }));
            reply({ type: 'remote_install_done', code: r.code, url: r.url });
          } catch (e) {
            reply({ type: 'remote_install_done', error: (e as Error).message });
          }
          break;
        }
        case 'migrate_to': {
          // Push this home to another server (paired via its code), then stand down here.
          const target = msg.url.replace(/\/$/, '');
          const n = await migrateHomeTo(target, msg.token, !!msg.force, (sent, total) => reply({ type: 'migrate_progress', sent, total }));
          reply({ type: 'migrated', direction: 'to', url: target, bots: n });
          break;
        }
        case 'steward': {
          // The product's own bot for "where do the bots live": make sure it exists, then say the first sentence for the user.
          const { bot, created } = ensureSteward(store);
          const threadId = botThread(bot.id);
          if (created) void ensureAvatar(bot);
          reply({ type: 'steward', botId: bot.id });
          router.onUserMessage(threadId, STEWARD_FIRST_QUERY[msg.intent], 'app');
          break;
        }
        case 'machine_connect': {
          // The connection card was submitted: log in with the password, keep it in the local credential file, look around, tell the steward what we found.
          if (config.authToken) throw new Error('只能从本机连接机器');
          const m = store.message(msg.messageId);
          const card = m?.card;
          if (!m || card?.type !== 'machine' || card.stage !== 'connect') throw new Error('这张卡不是连接卡');
          if (card.state === 'running') throw new Error('正在连接');
          const host = msg.host.trim();
          const user = msg.user.trim() || 'root';
          if (!host) throw new Error('先填机器的 IP');
          const patchCard = (p: Partial<Extract<Card, { type: 'machine' }>>) => {
            const c = store.message(msg.messageId)?.card;
            if (c?.type === 'machine') store.patchMessage(msg.messageId, { card: { ...c, ...p } });
          };
          patchCard({ state: 'running', log: [`正在连接 ${user}@${host}…`], error: undefined, summary: undefined });
          try {
            const link = await connectMachine({ host, user, port: msg.port, password: msg.password });
            patchCard({ log: [`已连上 ${user}@${host}`, '看看这台机器…'] });
            const survey = await surveyMachine(link);
            patchCard({ state: 'done', summary: survey.split('\n'), log: undefined });
            if (m.botId) void bots.send(m.botId, { threadId: m.threadId, kind: 'system', text: `用户在连接卡上填了机器，已连上 ${user}@${host}，密码已存进本机凭据（你用 machine_ssh 时系统自动代答 sudo）。体检：\n${survey}\n\n现在按「${STEWARD_SKILL_NAME}」技能的标准流程把它装好并搬过去，先 machine_probe。装的过程不用逐步汇报，用户在卡片里看得见；卡住或需要他动手时再说。` });
          } catch (e) {
            const err = (e as Error).message;
            patchCard({ state: 'error', error: err });
            if (m.botId) void bots.send(m.botId, { threadId: m.threadId, kind: 'system', text: `连接卡上填的机器连不上：${err}。按「${STEWARD_SKILL_NAME}」技能把原因说成人话，给一条下一步；卡片上有「改一下重试」。不要在对话里要密码。` });
          }
          break;
        }
        case 'machine_move': {
          // The move card was clicked: ship this home to the installed machine, then tell every client to follow.
          const m = store.message(msg.messageId);
          const card = m?.card;
          if (!m || card?.type !== 'machine' || card.stage !== 'move') throw new Error('这张卡不是搬家卡');
          if (card.state === 'running') throw new Error('正在搬');
          const saved = loadMachine();
          if (!saved?.url || !saved.token) throw new Error('那台机器还没配对');
          const target = { url: saved.url, token: saved.token, name: saved.name };
          const patchCard = (p: Partial<Extract<Card, { type: 'machine' }>>) => {
            const c = store.message(msg.messageId)?.card;
            if (c?.type === 'machine') store.patchMessage(msg.messageId, { card: { ...c, ...p } });
          };
          // Written before the export so they travel with the home and greet the user on the other side.
          patchCard({ state: 'done', error: undefined });
          const note = store.addMessage({ threadId: m.threadId, author: 'system', text: `bot 们已从「${runtime.info().hostname}」搬到「${target.name}」，以后在那儿干活。这台电脑关机也没关系。`, ts: Date.now() });
          try {
            await migrateHomeTo(target.url, target.token, true, (sent, total) => patchCard({ state: 'running', progress: { sent, total } }), target.name);
            patchCard({ state: 'done' });
            server.broadcast({ type: 'switch_runtime', url: target.url, token: target.token, name: target.name });
          } catch (e) {
            const err = (e as Error).message;
            patchCard({ state: 'error', error: err, progress: undefined });
            store.patchMessage(note.id, { text: `搬家没成功：${err}` });
            if (m.botId) void bots.send(m.botId, { threadId: m.threadId, kind: 'system', text: `搬家没成功：${err}。把原因说成人话，给一条下一步（多半是重试，或先 machine_status 看看那台机器还连得上不）。` });
          }
          break;
        }
        case 'migrate_from': {
          // Pull the home back from the server it currently lives on, then restart on it.
          const source = msg.url.replace(/\/$/, '');
          const r = await fetch(`${source}/migrate/export?to=${encodeURIComponent(config.publicUrl)}`, { headers: { authorization: `Bearer ${msg.token}` } }).catch(() => undefined);
          if (!r?.ok) throw new Error(r?.status === 401 ? '连接码不对，对方拒绝了' : '连不上那台机器，检查地址和网络');
          const tmp = join(config.home, `.import-${Date.now()}.tar.gz`);
          writeFileSync(tmp, Buffer.from(await r.arrayBuffer()));
          try {
            await stopRunning();
            const res2 = await Runtime.importArchive(tmp, { force: true });
            reply({ type: 'migrated', direction: 'from', url: source, bots: res2.bots });
            console.log(`[crew] home pulled back (${res2.bots} bots); restarting to load it`);
            setTimeout(() => process.exit(75), 400);
          } finally {
            rmSync(tmp, { force: true });
          }
          break;
        }
        case 'submit_login': {
          const card = store.message(msg.messageId)?.card;
          if (card?.type !== 'login') throw new Error('这张卡不在了');
          // The values go straight into the page and nowhere else: not to the store, not to the log, not to the bot.
          await logins.fill(msg.askId, msg.values);
          store.patchMessage(msg.messageId, { card: { ...card, done: true } });
          break;
        }
        case 'submit_secrets': {
          const i = store.integration(msg.integrationId);
          if (!i) throw new Error('连接不存在');
          const values = Object.fromEntries(Object.entries(msg.values).filter(([k, v]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim()]));
          const card = store.message(msg.messageId)?.card;
          if (card?.type === 'secrets') store.patchMessage(msg.messageId, { card: { ...card, done: true } });
          const thread = store.message(msg.messageId)?.threadId;
          const botId = store.message(msg.messageId)?.botId;
          if (i.kind === 'channel' && i.channel && i.channel !== 'app') {
            // An IM account belongs to the bot whose thread the card is in: it becomes that bot's own bot over there.
            if (!botId || !store.bot(botId)) throw new Error('这张卡不在某个 bot 的会话里，不知道接的是谁');
            const bot = store.bot(botId)!;
            const r = await channels.onSecrets(botId, i.channel, values);
            const account = store.bot(botId)?.im?.[i.channel]?.account;
            if (thread) store.addMessage({ threadId: thread, author: 'system', text: r.ok ? `${bot.name} 已接到${i.name}${account ? `，那边叫「${account}」` : ''}` : `${i.name} 凭据已填，但没接上：${r.note}`, ts: Date.now() });
            if (thread) {
              const okText =
                i.channel === 'wechat'
                  ? `用户已填好凭据，你在企业微信里的应用接上了。告诉他：回企业微信的应用设置里点「保存」让它验证回调地址，然后在企业微信里找到这个应用就能和你私聊。`
                  : `用户已填好凭据，你在${i.name}里的机器人${account ? `「${account}」` : ''}接上了。告诉他：直接在${i.name}里找到这个机器人私聊就是你；想让你和别的 bot 一起干活，把几个机器人拉进同一个群，@谁谁回。一句话说完，不要教他别的。`;
              const failText = `用户填了${i.name}的凭据，但没接上：${r.note}。用一句话告诉用户原因，让他核对后重填（再发一张凭据卡，request_credentials，integration 填「${i.name}」）。不要让他改配置文件，也不要自己去改配置或代码；不要把报错原文整段贴给用户，更不要在对话里写出任何密钥。`;
              void bots.send(botId, { threadId: thread, kind: 'system', text: r.ok ? okText : failText });
            }
            break;
          }
          store.patchIntegration(i.id, { env: { ...(i.env ?? {}), ...values } });
          const after = i.kind === 'mcp' && !i.connector ? await mcp.connect(i.id) : store.integration(i.id);
          const ok = after?.status === 'ok';
          if (thread) store.addMessage({ threadId: thread, author: 'system', text: ok ? `${i.name} 已连接${after?.tools?.length ? `，${after.tools.length} 个工具` : ''}` : `${i.name} 凭据已填，但连接没成功：${after?.note ?? ''}`, ts: Date.now() });
          if (thread && botId) {
            for (const b of store.data.bots) if (b.id === botId && !(b.integrationIds ?? []).includes(i.id)) store.patchBot(b.id, { integrationIds: [...(b.integrationIds ?? []), i.id] });
            await bots.refreshTools(botId);
            const okText = `用户已填好「${i.name}」的凭据，连接成功，它的工具已在你的列表里（${(after?.tools ?? []).map((t) => t.name).slice(0, 8).join('、')}）。接着办刚才的事。`;
            const failText = `用户填了「${i.name}」的凭据，但连接没成功：${after?.note ?? '未知原因'}。用一句话告诉用户原因，让他核对后重填（再发一张凭据卡）。不要让他改配置文件，也不要自己去改配置或代码；不要把报错原文整段贴给用户，更不要在对话里写出任何密钥。`;
            void bots.send(botId, { threadId: thread, kind: 'system', text: ok ? okText : failText });
          }
          break;
        }
        case 'connect_channel': {
          if (!IMS.includes(msg.channel as Im)) throw new Error('不认识这个 IM');
          channels.sendConnectCard(msg.botId, msg.channel as Im);
          break;
        }
        case 'disconnect_channel': {
          if (!IMS.includes(msg.channel as Im)) throw new Error('不认识这个 IM');
          channels.disconnect(msg.botId, msg.channel as Im);
          break;
        }
        case 'upgrade': {
          try {
            const r = await upgrader.run();
            reply({ type: 'upgrade_done', restarting: r.restarting });
          } catch (e) {
            reply({ type: 'upgrade_done', error: (e as Error).message });
          }
          // Ask the machine what it is on now, so the App stops saying there is a newer version.
          await refreshMachineBuild().catch(() => undefined);
          broadcastUpgrade();
          break;
        }
        case 'usage':
          reply({ type: 'usage', report: usageReport(store, msg.days ?? 30) });
          break;
        case 'set_settings':
          store.setSettings(msg.patch);
          // Every bot builds its prompt fresh each turn, so a language change takes effect on the next message.
          break;
        case 'computer_power': {
          if (msg.on) await desktops.wake();
          else await desktops.off();
          break;
        }
        case 'computer_focus':
          await desktops.focus();
          break;
        case 'add_integration': {
          const i = store.addIntegration({ ...msg.integration, status: msg.integration.kind === 'mcp' ? 'connecting' : 'off' });
          if (i.kind === 'mcp') void mcp.connect(i.id);
          break;
        }
        case 'patch_integration': {
          const i = store.patchIntegration(msg.id, msg.patch);
          if (i?.kind === 'mcp' && (msg.patch.command || msg.patch.args || msg.patch.url || msg.patch.env)) void mcp.connect(i.id);
          break;
        }
        case 'remove_integration': {
          const i = store.integration(msg.id);
          if (i?.connector) await connectors.disconnect(i.id);
          else await mcp.disconnect(msg.id);
          store.removeIntegration(msg.id);
          break;
        }
        case 'test_integration': {
          const i = store.integration(msg.id);
          if (i?.connector) void connectors.verify(i.id);
          else if (i?.kind === 'mcp') void mcp.connect(i.id);
          else if (i) {
            await seedIntegrations(store);
            // Agents the user's computer lends: re-apply after the local scan, and have the computer look again too.
            hosts.announce();
            hosts.redetect();
          }
          break;
        }
        case 'patch_skill':
          skills.of(msg.botId).patch(msg.name, msg.patch);
          break;
        case 'mount_library_skill':
          if (!store.bot(msg.botId)) throw new Error('bot 不存在');
          mountLibrary(msg.botId, [msg.slug]);
          break;
        case 'patch_matter':
          store.patchMatter(msg.id, msg.patch);
          break;
        case 'create_matter':
          router.createMatter(msg);
          break;
        case 'set_shared_profile':
          store.setSharedProfile(msg.lines);
          break;
        case 'undo_action':
          router.undoAction(msg.actionId);
          break;
        case 'avatar': {
          const bot = store.bot(msg.botId);
          if (!bot) break;
          if (msg.op === 'upload' && msg.dataUrl) store.patchBot(bot.id, { avatarUrl: msg.dataUrl });
          else if (msg.op === 'reset') store.patchBot(bot.id, { avatarUrl: undefined });
          else if (msg.op === 'regen') {
            const seed = `${bot.name}:${Date.now()}`;
            store.patchBot(bot.id, { avatarSeed: seed, avatarUrl: undefined });
            void ensureAvatar({ ...bot, avatarSeed: seed, avatarUrl: undefined });
          }
          break;
        }
        case 'clear_thread': {
          const { kind, id } = parseThread(msg.threadId);
          broker.cancelThread(msg.threadId);
          store.clearThread(msg.threadId);
          if (kind === 'bot') await bots.resetSession(id);
          else {
            const m = store.matter(id);
            for (const b of m ? [m.ownerBotId, ...m.participantBotIds] : []) void bots.send(b, { threadId: msg.threadId, kind: 'group', text: `【群聊记录】群「${m?.title ?? ''}」的聊天记录被用户清空了，之前群里的内容不再作数。` });
          }
          break;
        }
        case 'delete_matter': {
          const matter = store.deleteMatter(msg.id);
          if (!matter) break;
          for (const id of new Set([matter.ownerBotId, ...matter.participantBotIds])) {
            if (!store.bot(id)) continue;
            void bots.send(id, { threadId: botThread(id), kind: 'system', text: `群「${matter.title}」已被用户解散，相关事项已清除。不用回应这条消息，继续手上的事。`, depth: 0 }).catch(() => undefined);
          }
          break;
        }
        case 'delete_bot': {
          // 助理是产品自带的：删不掉。删了下次启动又会生成一个空的，那比留着更莫名其妙。
          // 改名、取消置顶、关通知、清聊天记录都行。
          if (store.bot(msg.id)?.kind === 'steward') throw new Error('助理是产品自带的，删不掉');
          const bot = store.deleteBot(msg.id);
          if (!bot) break;
          await bots.retire(bot.id);
          // Its manuals live in its directory, so they go with it.
          skills.drop(bot.id);
          rmSync(join(config.botsDir, bot.id), { recursive: true, force: true });
          for (const ext of ['png', 'jpg']) rmSync(join(config.avatarsDir, `${bot.id}.${ext}`), { force: true });
          break;
        }
        default:
          reply({ type: 'error', error: `unknown message type ${(msg as { type: string }).type}` });
      }
    },
  });

  // A signpost starts lending this computer's agents once the server exists (its state is broadcast to Apps).
  if (runtime.mode === 'moved') {
    startHostLink();
    void refreshMachineBuild();
    setInterval(() => void refreshMachineBuild(), 60_000).unref();
  }

  skills.on('change', (skill) => {
    server.broadcast({ type: 'skill', skill });
    // A manual just landed (seeded, mirrored from the pool, or written by a bot): whatever it says to run gets
    // installed now, in the background, rather than at the worst possible moment halfway through a deliverable.
    kickDeps(`技能 ${skill.name}`);
  });

  const shutdown = async () => {
    runtime.release();
    // Whatever is still accumulating in the memory engine: cut it into memories now, or that stretch is lost.
    await everos.flushAll().catch(() => {});
    everos.stopMemory();
    hostClient?.stop();
    notifier.stop();
    scheduler.stop();
    channels.stopAll();
    await desktops.stopAll();
    await bots.dispose();
    await mcp.dispose();
    store.flush();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
