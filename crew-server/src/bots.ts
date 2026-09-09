import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type ExtensionAPI,
  type InlineExtension,
} from '@earendil-works/pi-coding-agent';
import type { Model, Api } from '@earendil-works/pi-ai';
import { config } from './config.ts';
import type { CrewStore } from './store.ts';
import type { PendingBroker } from './broker.ts';
import { createBotUiContext } from './broker.ts';
import type { MemoryStore } from './memory.ts';
import type { FakeBrain } from './fake-brain.ts';
import type { SkillStore } from './skills.ts';
import type { AgentRunner, McpManager } from './integrations.ts';
import { agentExtension, mcpExtension } from './extensions/integrations.ts';
import { crewToolsExtension, type CrewOps } from './extensions/crew-tools.ts';
import { shellExtension } from './extensions/shell.ts';
import { computerExtension } from './extensions/computer.ts';
import { seeExtension } from './extensions/see.ts';
import { drawExtension } from './extensions/draw.ts';
import { canDraw } from './draw.ts';
import { DEFAULT_VISION_MODEL, resolveEyes, type Eyes } from './vision.ts';
import type { DesktopManager } from './desktop.ts';
import { BUILTIN_SKILL_NAMES } from './builtin-skills.ts';
import { buildExtension } from './extensions/build.ts';
import { libraryExtension } from './extensions/library.ts';
import { webExtension } from './extensions/web.ts';
import { connectExtension } from './extensions/connect.ts';
import { harvestExtension } from './extensions/harvest.ts';
import { operateExtension } from './extensions/operate.ts';
import type { Hands } from './gui.ts';
import { redactSecrets } from './secrets.ts';
import type { ConnectorManager } from './connectors.ts';
import type { BotCtx, CurrentTurn } from './extensions/ctx.ts';
import { identityExtension } from './extensions/identity.ts';
import { todoExtension } from './extensions/todo.ts';
import { askExtension } from './extensions/ask.ts';
import { actExtension } from './extensions/act.ts';
import { rememberExtension } from './extensions/remember.ts';
import { machineExtension } from './extensions/machine.ts';
import { vigilExtension } from './extensions/vigil.ts';
import { readExtension } from './extensions/read.ts';
import { CHANNEL_LABEL, botThread, parseThread, type Channel, type FileRef, type ThreadId } from './types.ts';
import { readFileSync } from 'node:fs';
import type { ImageContent } from '@earendil-works/pi-ai';
import { hasToolCalls, parseMentions, salvageFromThinking, textOf, thinkingOf, filesMentioned } from './util.ts';

export interface Inbound {
  threadId: ThreadId;
  /** 'user' -> session.prompt; others -> custom message injected via pi.sendMessage */
  kind: 'user' | 'bot' | 'routine' | 'group' | 'system';
  text: string;
  via?: Channel;
  /** deliver whatever the bot says this turn only to these (routines with a channel set) */
  to?: Channel[];
  userMessageId?: string;
  fromBotId?: string;
  depth?: number;
  /** the task this message is about (assigned work arrives bound to its todo) */
  todoId?: string;
  /** files the user attached (already saved under the bot's workspace/_in) */
  files?: FileRef[];
  /** this message cut the bot off mid-reply; `said` is what it had got out before the stop */
  cutIn?: { said: string };
}

interface BotRuntime {
  botId: string;
  session: AgentSession;
  pi: ExtensionAPI;
  refreshTools: () => Promise<void>;
  queue: Promise<void>;
  current?: CurrentTurn;
  unsubscribe: () => void;
  /** run-state tracking for injected (non-prompt) turns */
  running: boolean;
  settledWaiters: (() => void)[];
  startWaiters: (() => void)[];
  /** visible assistant messages emitted so far (to detect a turn that answered only in thinking) */
  textCount: number;
  /** user messages waiting for the coalescing window to close (one turn for a burst of messages) */
  gather?: { threadId: ThreadId; texts: string[]; ids: string[]; via?: Channel; timer: ReturnType<typeof setTimeout>; started: number; done: Promise<void>; go: () => void };
  /** the user cut in on this turn: tool calls that have not started yet are blocked until the model's next response */
  interrupt?: boolean;
  /** the run that is ending was cut short by the user (its empty output is not a model failure) */
  cutShort?: boolean;
  /** already told the model once this turn that it wrote tool-call markup as prose */
  markupNudged?: boolean;
}

/** DeepSeek-style tool-call markup that came out as text: the model meant to call a tool and called nothing. */
const TOOL_MARKUP = /<[｜|]DSML[｜|]|<[｜|]tool[▁_ ]?calls?[▁_ ]?(begin|end)?[｜|]>|<tool_calls?>|<\/tool_calls?>|<[｜|]tool[▁_]sep[｜|]>/;

/** A burst of messages within this window becomes one turn; the window never stretches past the cap. */
const GATHER_MS = 1200;
const GATHER_CAP_MS = 3500;

/**
 * One pi AgentSession per bot. Serializes inbound work per bot, maps pi events onto the
 * product transcript (typing, bot messages, @mention handoffs) and owns the model runtime.
 */
export class BotManager extends EventEmitter {
  private runtimes = new Map<string, Promise<BotRuntime>>();
  modelRuntime!: ModelRuntime;
  model: Model<Api> | undefined;
  lightModel: Model<Api> | undefined;
  /** The model that reads pictures for bots whose own model has no eyes (vision.ts). */
  eyes: Eyes | undefined;
  /** The model that works a screen from screenshots (gui.ts): guiModel, else the eyes. */
  hands: Hands | undefined;
  fake: FakeBrain | undefined;
  /** Product-level operations for create_bot / create_group / configure; set by index.ts before use. */
  ops: CrewOps | undefined;
  /** the bots' computers (desktop.ts); unset on a runtime that cannot host them */
  desktops: DesktopManager | undefined;

  constructor(
    private store: CrewStore,
    private broker: PendingBroker,
    private memory: MemoryStore,
    private events: EventEmitter,
    private skills: SkillStore,
    private mcp: McpManager,
    private runner: AgentRunner,
    private connectors: ConnectorManager,
  ) {
    super();
  }

  async init(fakeFactory: () => FakeBrain) {
    this.modelRuntime = await ModelRuntime.create({ allowModelNetwork: false });
    const pick = (spec?: string) => {
      if (!spec) return undefined;
      const i = spec.indexOf('/');
      return i > 0 ? this.modelRuntime.getModel(spec.slice(0, i), spec.slice(i + 1)) : undefined;
    };
    this.model = pick(config.model) ?? this.registerConfiguredModel(config.model);
    this.lightModel = pick(config.lightModel) ?? this.registerConfiguredModel(config.lightModel) ?? this.model;
    const anyAuth = this.modelRuntime.getProviders().some((p) => this.modelRuntime.hasConfiguredAuth(p.id));
    if (config.fake || (!this.model && !anyAuth)) {
      this.fake = fakeFactory();
      this.modelRuntime.registerNativeProvider(this.fake.handle.provider);
      this.model = this.fake.model;
      this.lightModel = this.model;
      console.log('[crew] no model keys configured: running with the scripted fake brain (set keys in config.json to go live)');
    } else {
      console.log(`[crew] model: ${this.model ? `${this.model.provider}/${this.model.id}` : 'pi default'}`);
    }
    // Eyes for the `see` tool: the model set for it (registered on the fly when pi's catalog does not know it),
    // otherwise whichever of the bots' own models can already take images.
    const visionSpec = config.visionModel ?? DEFAULT_VISION_MODEL;
    const vision = pick(visionSpec) ?? this.registerConfiguredModel(visionSpec, { vision: true });
    this.eyes = resolveEyes(this.modelRuntime, vision, this.model, this.lightModel);
    if (this.eyes) console.log(`[crew] vision: ${this.eyes.model.provider}/${this.eyes.model.id}`);
    else console.warn('[crew] no vision model: bots can read documents but not pictures (set visionModel in config.json)');
    // Hands for the `operate` tool: the model set for it (a computer-use model), else whatever the eyes are.
    if (config.guiModel && this.modelRuntime) {
      const gui = pick(config.guiModel) ?? this.registerConfiguredModel(config.guiModel, { vision: true });
      this.hands = gui ? { runtime: this.modelRuntime, model: gui } : this.eyes;
    } else this.hands = this.eyes;
    if (this.hands) console.log(`[crew] hands: ${this.hands.model.provider}/${this.hands.model.id}${config.guiModel ? '' : ' (no guiModel; using the eyes)'}`);
  }

  /**
   * pi's static catalog may not list a newly released model (e.g. deepseek/deepseek-v4-flash on
   * OpenRouter). Register it on top of the built-in provider so auth, base URL and API come from
   * the provider and only the model entry is ours.
   */
  private registerConfiguredModel(spec?: string, as?: { vision?: boolean }): Model<Api> | undefined {
    if (!spec) return undefined;
    const i = spec.indexOf('/');
    if (i <= 0) return undefined;
    const provider = spec.slice(0, i);
    const id = spec.slice(i + 1);
    if (!this.modelRuntime.getProvider(provider)) return undefined;
    const info = as ? { ...config.modelInfo, ...as } : config.modelInfo;
    this.modelRuntime.registerProvider(provider, {
      models: [
        {
          id,
          name: id,
          reasoning: info?.reasoning ?? false,
          input: info?.vision ? ['text', 'image'] : ['text'],
          cost: { input: info?.costIn ?? 0, output: info?.costOut ?? 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: info?.contextWindow ?? 128_000,
          maxTokens: info?.maxTokens ?? 16_000,
        },
      ],
    });
    const m = this.modelRuntime.getModel(provider, id);
    if (m) console.log(`[crew] registered ${spec} on top of the built-in ${provider} provider`);
    return m;
  }

  get mode(): 'live' | 'fake' {
    return this.fake ? 'fake' : 'live';
  }

  private ctxFor(botId: string, runtime: () => BotRuntime | undefined): BotCtx {
    return {
      botId,
      bot: () => this.store.bot(botId)!,
      store: this.store,
      broker: this.broker,
      memory: this.memory,
      events: this.events,
      current: () => runtime()?.current,
      fake: !!this.fake,
    };
  }

  ensure(botId: string): Promise<BotRuntime> {
    let p = this.runtimes.get(botId);
    if (!p) {
      p = this.create(botId);
      this.runtimes.set(botId, p);
      p.catch(() => this.runtimes.delete(botId));
    }
    return p;
  }

  private async create(botId: string): Promise<BotRuntime> {
    const bot = this.store.bot(botId);
    if (!bot) throw new Error(`unknown bot ${botId}`);
    const botDir = join(config.botsDir, botId);
    const sessionsDir = join(botDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    this.memory.sync(botId);

    let rt: BotRuntime | undefined;
    const ctx = this.ctxFor(botId, () => rt);
    let captured: ExtensionAPI | undefined;
    const bridge: InlineExtension = {
      name: 'crew-bridge',
      factory: (pi) => {
        captured = pi;
        // A user cut in while tools were running: the one in flight finishes, the rest of the batch is dropped.
        pi.on('tool_call', () => (rt?.interrupt ? { block: true, reason: '用户刚插话了，这个调用作废。先看用户的新消息，再决定要不要做。' } : undefined));
      },
    };
    const perform = async (p: { connection: string; action: string; amount?: number }) =>
      `（${p.connection} · ${p.action}${p.amount ? ` · ¥${p.amount}` : ''} 已通过连接执行。）`;

    const mcpExt = mcpExtension(ctx, this.mcp, this.connectors);
    const shellExt = shellExtension(ctx);
    const loader = new DefaultResourceLoader({
      cwd: botDir,
      agentDir: config.piAgentDir,
      noExtensions: true,
      extensionFactories: [
        bridge,
        identityExtension(ctx, () => this.skills, () => this.ops),
        todoExtension(ctx),
        askExtension(ctx),
        actExtension(ctx, perform),
        rememberExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
        webExtension(),
        harvestExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
        connectExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
        buildExtension(ctx, () => this.skills, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
        vigilExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops.vigil();
        }),
        libraryExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
        // The steward alone may hand the user machine cards (install over ssh, move the home).
        ...(bot.kind === 'steward'
          ? [
              machineExtension(ctx, () => {
                if (!this.ops) throw new Error('crew ops not ready');
                return this.ops;
              }),
            ]
          : []),
        mcpExt,
        agentExtension(ctx, this.runner),
        computerExtension(ctx, () => this.desktops),
        operateExtension(ctx, () => this.hands, () => this.desktops),
        seeExtension(ctx, () => this.eyes),
        ...(canDraw() ? [drawExtension(ctx)] : []),
        readExtension(ctx),
        shellExt,
        crewToolsExtension(ctx, () => {
          if (!this.ops) throw new Error('crew ops not ready');
          return this.ops;
        }),
      ],
      skillsOverride: (base) => {
        // Bot.skills holds display names; pi skill names are the slugs written by SkillStore.
        const mine = new Set([...(this.store.bot(botId)?.skills ?? bot.skills), ...BUILTIN_SKILL_NAMES].map((n) => this.skills.slugFor(n)));
        return { skills: base.skills.filter((s) => mine.has(s.name)), diagnostics: base.diagnostics };
      },
      systemPromptOverride: () => '你是用户团队里的一个 bot。用中文，简短、直接。',
    });
    await loader.reload();

    const hasSessions = existsSync(sessionsDir) && readdirSync(sessionsDir).some((f) => f.endsWith('.jsonl'));
    const sessionManager = hasSessions ? SessionManager.continueRecent(botDir, sessionsDir) : SessionManager.create(botDir, sessionsDir);

    const { session } = await createAgentSession({
      cwd: botDir,
      agentDir: config.piAgentDir,
      modelRuntime: this.modelRuntime,
      model: this.model,
      resourceLoader: loader,
      sessionManager,
      noTools: 'builtin',
      sessionStartEvent: { type: 'session_start', reason: hasSessions ? 'resume' : 'startup' },
    });
    if (!captured) throw new Error('crew-bridge extension did not load');

    const where = () => {
      const c = rt?.current;
      return { threadId: c?.threadId ?? botThread(botId), matterId: c?.matterId, todoId: c?.todoId, via: c?.via };
    };
    await session.bindExtensions({ uiContext: createBotUiContext(this.broker, this.store, botId, where), mode: 'rpc' });

    const unsubscribe = session.subscribe((ev) => this.onEvent(botId, ev));
    rt = { botId, session, pi: captured, queue: Promise.resolve(), unsubscribe, refreshTools: async () => {
        await mcpExt.refresh();
        await shellExt.refresh();
      }, running: false, settledWaiters: [], startWaiters: [], textCount: 0 };
    return rt;
  }

  private onEvent(botId: string, ev: AgentSessionEvent) {
    const rt = this.runtimeSync(botId);
    const cur = rt?.current;
    const threadId = cur?.threadId ?? botThread(botId);
    switch (ev.type) {
      case 'agent_start':
        this.store.typing(threadId, botId, true);
        if (rt) {
          rt.running = true;
          rt.markupNudged = false;
          for (const w of rt.startWaiters.splice(0)) w();
        }
        break;
      case 'agent_settled':
        this.store.typing(threadId, botId, false);
        if (rt) {
          rt.running = false;
          for (const w of rt.settledWaiters.splice(0)) w();
        }
        break;
      case 'message_start':
        // The model is answering again (with the cut-in message in view): its new tool calls are wanted.
        if (rt && (ev.message as { role: string }).role === 'assistant') rt.interrupt = false;
        break;
      case 'message_end': {
        const m = ev.message as { role: string; content: unknown; stopReason?: string };
        if (m.role !== 'assistant') break;
        if (m.stopReason === 'aborted') {
          // Cut short by the user. Whatever got out stays on screen, marked; no handoffs or task updates from a half-thought.
          const said = redactSecrets(textOf(m.content).trim(), this.store);
          if (said) {
            if (rt) rt.textCount += 1;
            this.store.addMessage({ threadId, author: 'bot', botId, text: said, ts: Date.now(), todoId: cur?.todoId, via: cur?.via, to: cur?.to, status: 'interrupted' });
          }
          break;
        }
        // Whatever the model is about to say, minus every credential the product holds (it may have met one on a page).
        let text = redactSecrets(textOf(m.content).replace(/^（已同步）$/, ''), this.store);
        if (!text && !hasToolCalls(m.content)) {
          // The answer went into the thinking channel: show what it concluded rather than nothing.
          const salvaged = salvageFromThinking(thinkingOf(m.content));
          if (salvaged) {
            console.warn(`[crew] bot ${botId}: no text, showing thinking tail (${salvaged.length} chars)`);
            text = redactSecrets(salvaged, this.store);
          }
        }
        if (!text) break;
        if (TOOL_MARKUP.test(text)) {
          // Not a reply: a tool call that never happened. Keep it off the screen and have the model do it properly.
          console.warn(`[crew] bot ${botId}: tool-call markup in prose (${text.length} chars), nudging`);
          if (rt && !rt.markupNudged) {
            rt.markupNudged = true;
            void this.send(botId, { threadId, kind: 'system', text: '【系统】你上一条把工具调用写成了正文（<｜DSML｜… 这类标记），没有任何工具被真正调用，用户也没看到它。请用真正的工具调用重做刚才那一步；不需要工具就用正常文字回复。', depth: (cur?.depth ?? 0) + 1 });
          }
          break;
        }
        if (rt) rt.textCount += 1;
        // Inside a group only members can be addressed; an @ to an outsider is text, not a handoff.
        const matter = cur?.matterId ? this.store.matter(cur.matterId) : undefined;
        const candidates = matter ? this.store.data.bots.filter((b) => b.id === matter.ownerBotId || matter.participantBotIds.includes(b.id)) : this.store.data.bots;
        const mentions = parseMentions(text, candidates, botId);
        if (matter) {
          const outsiders = parseMentions(text, this.store.data.bots.filter((b) => !candidates.includes(b)), botId);
          if (outsiders.length) {
            const names = outsiders.map((id) => '@' + (this.store.bot(id)?.name ?? id)).join('、');
            this.store.addMessage({ threadId, author: 'system', text: `${names} 不在这个群里，没有收到。要让它参与，先把它加进群。`, ts: Date.now() });
            void this.send(botId, { threadId, kind: 'system', text: `你刚才 @ 的 ${names} 不在群「${matter.title}」里，没有收到。需要它参与就先 configure(target=matter, field=members, action=add, value="它的名字") 把它拉进群，再在回复里 @它；不需要就不用管。`, depth: (cur?.depth ?? 0) + 1 });
          }
        }
        const files = filesMentioned(text, join(config.botsDir, botId), config.publicUrl, botId);
        this.store.addMessage({ threadId, author: 'bot', botId, text, ts: Date.now(), todoId: cur?.todoId, via: cur?.via, to: cur?.to, mentions: mentions.length ? mentions : undefined, files: files.length ? files : undefined });
        // Fallback bookkeeping: only when the model did not touch the todo itself this turn. Its own
        // summary is a written progress line; a truncated reply is a poor substitute for it.
        if (cur?.todoId && !cur.receipt) {
          const t = this.store.todo(cur.todoId);
          if (t && t.status !== 'done') this.store.patchTodo(cur.todoId, { summary: text.length > 48 ? text.slice(0, 48) + '…' : text, ...(t.status === 'open' ? { status: 'doing' as const } : {}) });
        }
        for (const to of mentions) {
          this.events.emit('crew:handoff', { from: botId, to, text, threadId, matterId: cur?.matterId, depth: (cur?.depth ?? 0) + 1 });
        }
        break;
      }
      default:
        break;
    }
  }

  private resolved = new Map<string, BotRuntime>();
  private runtimeSync(botId: string) {
    return this.resolved.get(botId);
  }

  /** Bots in the middle of a turn right now, by name: a restart would cut them off. */
  busyNames(): string[] {
    const out: string[] = [];
    for (const [id, rt] of this.resolved) if (rt.running || rt.session.isStreaming) out.push(this.store.bot(id)?.name ?? id);
    return out;
  }

  /** Queue inbound work for a bot. Resolves when the bot has settled. */
  /**
   * Inbound user messages take one of three paths:
   *   steer    the bot is mid-turn on this very thread → inject now; the model sees it after the current tool call
   *   gather   the bot is idle → hold for a short window so a burst of short messages becomes one turn
   *   queue    anything else (other threads, bot/routine/system injections) → strict FIFO per bot
   */
  send(botId: string, inbound: Inbound): Promise<void> {
    if (inbound.kind !== 'user') return this.enqueue(botId, inbound);
    return (async () => {
      const rt = await this.ensure(botId);
      const busyHere = rt.session.isStreaming && rt.current?.threadId === inbound.threadId && !rt.gather;
      if (busyHere) {
        if (rt.current && inbound.userMessageId) rt.current.userMessageId = inbound.userMessageId;
        rt.interrupt = true;
        if (rt.session.agent.state.pendingToolCalls.size > 0) {
          // Tool node: the running tool finishes (killing a half-done write corrupts files), the rest of the batch is
          // blocked by the tool_call hook, and the model reads the cut-in before its next call.
          const steer = withAttachments(sourceMark(rt.current?.matterId ? this.store.matter(rt.current.matterId)?.title : undefined, inbound.via) + inbound.text, inbound.files, config.modelInfo?.vision === true);
          await rt.session.prompt(cutInPrompt('tool', undefined, steer.text), { expandPromptTemplates: false, streamingBehavior: 'steer', ...(steer.images.length ? { images: steer.images } : {}) });
          return rt.queue;
        }
        // LLM node: stop generating now. What already got out stays on screen; pi drops the aborted message from the
        // model's context, so the next turn quotes it back together with the new message and asks for a re-decision.
        rt.cutShort = true;
        this.store.typing(inbound.threadId, botId, true);
        await rt.session.abort();
        return this.enqueue(botId, { ...inbound, cutIn: { said: lastAbortedText(rt) } });
      }
      if (rt.gather && rt.gather.threadId === inbound.threadId) {
        const g = rt.gather;
        g.texts.push(inbound.text);
        if (inbound.userMessageId) g.ids.push(inbound.userMessageId);
        clearTimeout(g.timer);
        g.timer = setTimeout(g.go, Math.max(0, Math.min(GATHER_MS, g.started + GATHER_CAP_MS - Date.now())));
        return g.done;
      }
      let go!: () => void;
      const done = new Promise<void>((resolve) => {
        go = () => {
          const g = rt.gather!;
          rt.gather = undefined;
          resolve(this.enqueue(botId, { ...inbound, text: g.texts.join('\n'), userMessageId: g.ids[g.ids.length - 1] }));
        };
      });
      rt.gather = { threadId: inbound.threadId, texts: [inbound.text], ids: inbound.userMessageId ? [inbound.userMessageId] : [], via: inbound.via, started: Date.now(), timer: setTimeout(() => go(), GATHER_MS), done, go };
      this.store.typing(inbound.threadId, botId, true);
      return done;
    })();
  }

  private enqueue(botId: string, inbound: Inbound): Promise<void> {
    const run = async () => {
      // "Working" shows from the moment the bot picks this up (session load, tool loops, all of it), until it settles.
      this.store.typing(inbound.threadId, botId, true);
      const rt = await this.ensure(botId);
      this.resolved.set(botId, rt);
      rt.cutShort = false;
      const { kind: tk, id: tid } = parseThread(inbound.threadId);
      rt.current = {
        threadId: inbound.threadId,
        matterId: tk === 'matter' ? tid : undefined,
        userMessageId: inbound.userMessageId,
        via: inbound.via,
        to: inbound.to,
        kind: inbound.kind,
        fromBotId: inbound.fromBotId,
        depth: inbound.depth ?? 0,
        todoId: inbound.todoId,
      };
      try {
        if (inbound.kind === 'user') {
          const groupTitle = tk === 'matter' ? this.store.matter(tid)?.title : undefined;
          const before = rt.textCount;
          const p = withAttachments(sourceMark(groupTitle, inbound.via) + inbound.text, inbound.files, config.modelInfo?.vision === true);
          const text = inbound.cutIn ? cutInPrompt('llm', inbound.cutIn.said, p.text) : p.text;
          await rt.session.prompt(text, { expandPromptTemplates: false, ...(p.images.length ? { images: p.images } : {}) });
          if (rt.textCount === before && !this.fake && !rt.cutShort) {
            // The model sometimes puts the whole answer in its thinking block and emits no text. Nudge once.
            console.warn(`[crew] bot ${botId}: empty reply, nudging`);
            rt.pi.sendMessage({ customType: 'system', content: '你上一轮没有输出正文，用户什么都没看到（思考内容用户看不见）。现在把要对用户说的话作为正文发出来，一两句即可。', display: false }, { deliverAs: 'followUp', triggerTurn: true });
            await this.untilSettled(rt);
          }
        } else if (inbound.kind === 'group') {
          rt.pi.sendMessage({ customType: 'group-transcript', content: inbound.text, display: false }, { deliverAs: 'nextTurn' });
        } else {
          const customType = inbound.kind === 'bot' ? 'from-bot' : inbound.kind === 'routine' ? 'routine' : 'system';
          rt.pi.sendMessage({ customType, content: inbound.text, display: true }, { deliverAs: 'followUp', triggerTurn: true });
          await this.untilSettled(rt);
        }
      } catch (e) {
        console.error(`[crew] bot ${botId} failed:`, e);
        this.store.addMessage({ threadId: inbound.threadId, author: 'system', text: `（${this.store.bot(botId)?.name ?? botId} 出错了：${(e as Error).message}）`, ts: Date.now() });
      } finally {
        this.store.typing(inbound.threadId, botId, false);
        rt.current = undefined;
      }
    };
    const rtP = this.ensure(botId);
    const chained = rtP.then((rt) => {
      rt.queue = rt.queue.then(run, run);
      return rt.queue;
    });
    return chained;
  }

  /**
   * After injecting a message with triggerTurn, wait for the run it starts to settle. The run
   * begins asynchronously, so first wait (briefly) for agent_start; if none comes, the model had
   * nothing to do and we return.
   */
  private async untilSettled(rt: BotRuntime, startTimeoutMs = 8000) {
    if (!rt.running) {
      const started = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => resolve(false), startTimeoutMs);
        rt.startWaiters.push(() => {
          clearTimeout(t);
          resolve(true);
        });
      });
      if (!started) return;
    }
    await new Promise<void>((resolve) => rt.settledWaiters.push(resolve));
  }

  /** A bot's integration grants changed: register any newly available MCP tools on its live session. */
  async refreshTools(botId: string) {
    const p = this.runtimes.get(botId);
    if (!p) return;
    try {
      await (await p).refreshTools();
    } catch (e) {
      console.warn('[crew] refreshTools failed:', (e as Error).message);
    }
  }

  /**
   * Skills are loaded when a session is created, so after a new manual is written the session is
   * recreated at the next message — but only once the bot is idle, so no turn is cut short.
   */
  async recycle(botId: string) {
    const p = this.runtimes.get(botId);
    if (!p) return;
    const rt = await p;
    await rt.queue.catch(() => undefined);
    if (rt.running) await new Promise<void>((resolve) => rt.settledWaiters.push(resolve));
    if (this.runtimes.get(botId) === p) await this.retire(botId);
  }

  /** Forget the conversation: abort, dispose and delete the pi session files. The next message starts fresh. */
  async resetSession(botId: string) {
    await this.retire(botId);
    rmSync(join(config.botsDir, botId, 'sessions'), { recursive: true, force: true });
  }

  /** Tear down one bot's session (used when the bot is deleted). */
  async retire(botId: string) {
    const p = this.runtimes.get(botId);
    this.runtimes.delete(botId);
    this.resolved.delete(botId);
    if (!p) return;
    try {
      const rt = await p;
      rt.unsubscribe();
      await rt.session.abort();
      rt.session.dispose();
    } catch {
      /* ignore */
    }
  }

  async dispose() {
    for (const p of this.runtimes.values()) {
      try {
        const rt = await p;
        rt.unsubscribe();
        rt.session.dispose();
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Where a user message came from, as the model sees it: nothing for a plain App private message,
 * 【飞书】 for an IM channel, 【群聊「x」· 用户】 in a group, 【群聊「x」· 用户 · 飞书】 for both.
 */
function sourceMark(groupTitle: string | undefined, via: Channel | undefined): string {
  const ch = via && via !== 'app' ? CHANNEL_LABEL[via] : undefined;
  if (groupTitle) return `【群聊「${groupTitle}」· 用户${ch ? ` · ${ch}` : ''}】`;
  return ch ? `【${ch}】` : '';
}

/** What the model had said before the user cut in, from pi's transcript (the aborted message is still the last one). */
function lastAbortedText(rt: BotRuntime): string {
  const msgs = rt.session.agent.state.messages as { role: string; stopReason?: string; content: unknown }[];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'assistant') return m.stopReason === 'aborted' ? textOf(m.content).trim() : '';
  }
  return '';
}

/** A long quote keeps its head and tail; the middle is what the user has already scrolled past. */
function excerpt(s: string, max = 1200): string {
  return s.length <= max ? s : `${s.slice(0, Math.floor(max * 0.7))}\n……\n${s.slice(-Math.floor(max * 0.3))}`;
}

/**
 * The user spoke while the bot was mid-turn. The model's partial output is not in its context any more (pi drops
 * aborted messages), so it is quoted back, marked as cut off, and the model is asked to re-decide rather than to
 * finish the old plan.
 */
function cutInPrompt(at: 'llm' | 'tool', said: string | undefined, userPart: string): string {
  const head =
    at === 'tool'
      ? '【插入】你正在执行工具时，用户发来了新消息。还没开始的工具调用已经作废；已经跑完的结果照常在上面。'
      : said
        ? `【插入】你上一条回复说到一半被用户的新消息打断了。你已经说出去、用户看到的部分是：\n「${excerpt(said)}」\n后面没说完的部分作废。`
        : '【插入】你上一条回复刚开始就被用户的新消息打断了，用户没看到任何内容。';
  return `${head}\n先看新消息，判断刚才在做的事哪些还成立：还成立的接着做，不成立的直接放弃，不要把旧方案补完，也不要重复已经说过的内容。\n\n用户说：\n${userPart}`;
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
/**
 * Attachments as the model sees them: a【附件】block with full paths (bash can open them), plus the images
 * themselves when the model can see (vision). Without vision the bot is told it can't view the picture.
 */
function withAttachments(text: string, files: FileRef[] | undefined, vision: boolean): { text: string; images: ImageContent[] } {
  if (!files?.length) return { text, images: [] };
  const images: ImageContent[] = [];
  const lines = files.map((f) => {
    const abs = f.botId ? join(config.botsDir, f.botId, f.path) : f.path;
    if (f.mime.startsWith('image/') && vision) {
      try {
        images.push({ type: 'image', data: readFileSync(abs).toString('base64'), mimeType: f.mime.split(';')[0] });
      } catch {
        /* unreadable: path only */
      }
    }
    return `- ${f.name}（${f.mime.split(';')[0]}，${fmtSize(f.size)}）：${abs}`;
  });
  const seeable = files.some((f) => /^(image\/|application\/pdf)/.test(f.mime) || /\.(pptx?|docx?|xlsx?|pdf)$/i.test(f.name));
  const note = images.length
    ? '图片已附在这条消息里，你能直接看。'
    : seeable
      ? '要看图片、PDF、PPT、Word、Excel 的内容，用 see(路径)，它会读成文字给你；不要问用户「能描述一下吗」。'
      : '';
  return { text: `${text}\n\n【附件】\n${lines.join('\n')}\n文件已在你的工作区，用 bash 直接读。${note}`.trim(), images };
}
