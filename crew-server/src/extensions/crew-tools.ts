import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { CHANNEL_LABEL, type Bot, type BuildAspect, type BuildJob, type Channel, type Matter, type ThreadId, type LibraryEntry } from '../types.ts';
import * as everos from '../everos.ts';

/** Product operations the tools need; implemented in index.ts where the whole system is wired. */
export interface CrewOps {
  /** put the credentials card for one IM into the bot's thread: the bot becomes its own bot over there */
  connectChannel(botId: string, channel: Exclude<Channel, 'app'>, threadId?: ThreadId): void;
  /** take the bot off an IM: stop its account there and forget the credentials */
  disconnectChannel(botId: string, channel: Exclude<Channel, 'app'>): void;
  createBot(brief: string, opts: { name?: string; byBotId: string; task?: string }): Promise<Bot>;
  createGroup(opts: { title: string; summary?: string; memberIds: string[]; leadId: string; task?: string; byBotId: string }): Promise<Matter>;
  addMcp(i: { name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string> }): Promise<{ id: string; status: string; note?: string; tools?: number }>;
  /** give this bot an existing integration (and put its tools in front of it right away) */
  grant(botId: string, integrationId: string): Promise<void>;
  removeIntegration(id: string): void;
  /** start an asynchronous self-build; resolves as soon as the job is registered */
  build(botId: string, spec: BuildSpec): Promise<BuildJob>;
  /** hand the user an authorization card for a built-in connector (or report it's already connected / unavailable) */
  connect(botId: string, threadId: ThreadId, service: string, why?: string): Promise<{ status: 'connected' | 'card' | 'unavailable' | 'unknown'; text: string }>;
  /** lexical search over the curated skill library; empty query lists everything */
  librarySearch(query: string, limit?: number): (LibraryEntry & { categoryLabel: string; kindLabel: string })[];
  /** The same pool, searched by meaning as well as by words (library.ts). One embedding call, so: not per turn. */
  libraryFind(query: string, limit?: number): Promise<(LibraryEntry & { categoryLabel: string; kindLabel: string })[]>;
  /** copy a library skill onto a bot (idempotent) */
  /** Equip this bot with one pool entry, whatever kind it is: mount a manual, connect an MCP server, send a
   *  one-click card, download an asset pack. Installing dependencies is part of it. */
  equip(botId: string, slug: string, threadId: ThreadId): Promise<{ text: string; kind: string }>;
  /** steward only: this machine, and the machine the user is moving the bots to (if one was installed) */
  machineStatus(): Promise<MachineStatus>;
  /** read a credential off a page in the shared browser straight into the bot's IM account / a connection's env (never through the model); or the setup facts for a target */
  harvest(botId: string, spec: { action: 'take' | 'info'; target: string; field?: string; url?: string; selector?: string; near?: string; threadId?: ThreadId }): Promise<string>;
  /** the round trip that proves an IM is really connected: hand out a code, then say whether it came back */
  channelCheck(botId: string, channel: string, action: 'arm' | 'status'): Promise<string>;
  /** a login wall on the shared computer, moved into the conversation: a live QR to scan, or a card to fill */
  askLogin(
    botId: string,
    threadId: ThreadId | undefined,
    spec: { kind: 'qr' | 'password'; url?: string; title?: string; selector?: string; accountSelector?: string; passwordSelector?: string; submitSelector?: string; note?: string },
  ): Promise<string>;
  /** the vigil manager, for the vigil (值守) tool */
  vigil(): import('../vigil.ts').VigilManager;
  /** change a bot's avatar: 'regen' | 'reset' | a look description | an image file the bot produced */
  avatar(botId: string, value: string): Promise<string>;
}

export interface MachineStatus {
  here: { hostname: string; platform: string; mode: string; bots: number; local: boolean };
  target?: { name: string; host: string; user: string; connectedAt: number; url?: string; port?: string; pairedAt?: number; reachable?: boolean; note?: string };
}

export interface BuildSpec {
  aspect: BuildAspect;
  trigger: string;
  change: string;
  skill?: string;
}

const ConfigureParams = Type.Object({
  target: StringEnum(['bot', 'matter', 'profile'] as const),
  action: StringEnum(['get', 'set', 'add', 'remove'] as const),
  id: Type.Optional(Type.String({ description: 'bot 或群聊的 id 或名字；缺省为你自己' })),
  field: Type.Optional(
    Type.String({
      description:
        'bot（只有产品层设置）: autonomy(tell|prepare|do) | notify | pinned | avatar(regen 重画 / reset 用默认 / 一句外观描述 / 你生成的图片文件绝对路径)；matter: title | summary | members | lead | notify | pinned；profile: 只读',
    }),
  ),
  value: Type.Optional(Type.Any({ description: 'set 的新值；add/remove 的条目' })),
});

/**
 * Three product-level tools available to every bot:
 *   create_bot   spin up a new teammate from a one-sentence brief (optionally hand it a first task)
 *   create_group pull a group chat around a matter, optionally dropping a task in
 *   configure    every user-configurable thing in the product, atomized: get/set/add/remove
 */
export function crewToolsExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const findBot = (ref?: string): Bot | undefined => {
    if (!ref) return c.bot();
    return c.store.bot(ref) ?? c.store.data.bots.find((b) => b.name === ref.replace(/^@/, ''));
  };
  const findMatter = (ref?: string): Matter | undefined => {
    if (!ref) return c.current()?.matterId ? c.store.matter(c.current()!.matterId!) : undefined;
    return c.store.matter(ref) ?? c.store.data.matters.find((m) => m.title === ref);
  };
  const describeBot = (b: Bot) => {
    const integ = c.store.data.integrations.filter((i) => (b.integrationIds ?? []).includes(i.id)).map((i) => `${i.name}(${i.kind})`);
    return [
      `id: ${b.id}`,
      `名字: ${b.name}`,
      `简介: ${b.tagline}`,
      `工作方式(role，build 改): ${b.role}`,
      `人设(soul，build 改): ${b.soul || '（未写）'}`,
      `自主度: ${b.autonomy}；通知: ${b.notify}；置顶: ${b.pinned}`,
      `技能: ${b.skills.join('、') || '（无）'}`,
      `例行任务: ${b.routines.map((r) => `${r.title}（${r.schedule}${r.channels?.length ? `，发到 ${r.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join('、')}` : ''}${r.enabled ? '' : '，已停用'}）`).join('；') || '（无）'}`,
      `集成: ${integ.join('、') || '（无）'}`,
      `IM: ${
        Object.entries(b.im ?? {})
          .map(([ch, l]) => `${{ feishu: '飞书', telegram: 'Telegram', slack: 'Slack', wechat: '企业微信', app: 'App' }[ch] ?? ch}（${l?.status === 'ok' ? `已接${l.account ? `，那边叫「${l.account}」` : ''}` : l?.status === 'connecting' ? '连接中' : `没接上：${l?.note ?? ''}`}）`)
          .join('；') || '（没接任何 IM；用 build(aspect=channel, action=add, value="飞书") 接）'
      }`,
      `关于用户（全员共用的画像）: ${(everos.profileDoc()?.explicit ?? []).map((e) => e.description).join('；') || '（还没聚出来）'}`,
    ].join('\n');
  };

  return {
    name: 'crew-tools',
    factory: (pi) => {
      pi.registerTool({
        name: 'create_bot',
        label: '新建 bot',
        description:
          '为用户新建一个长期服务的 bot（团队里多一个专职同事）。给一句用户口吻的话说明它管什么，系统会生成名字、职责、技能和头像，几秒后它就能接活。可以顺手把第一个任务交给它。',
        promptSnippet: '新建一个长期专职的 bot（可附首个任务）',
        promptGuidelines: [
          '只有两种情况用 create_bot：用户明确要一个新的专职 bot；或某件事明显不属于你的职责、以后还会反复出现，而团队里没有合适的 bot（先用 configure(target=bot, action=get) 看一眼）。',
          '一次性的事不要建 bot；能 @ 现有 bot 转交的不要建。建之前不必问用户确认，但建完要告诉他 bot 叫什么、管什么。',
        ],
        parameters: Type.Object({
          brief: Type.String({ description: '它管什么，用用户口吻的一句话，如「帮我盯竞品动态，每周五给我一页纸」' }),
          name: Type.Optional(Type.String({ description: '指定名字（可不填，系统会起）' })),
          task: Type.Optional(Type.String({ description: '要顺手交给它的第一个任务' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p) {
          const bot = await ops().createBot(p.brief, { name: p.name, byBotId: c.botId, task: p.task });
          return { content: [{ type: 'text', text: `已新建 bot「${bot.name}」（id ${bot.id}）：${bot.role}${p.task ? ' 首个任务已转交。' : ''} 在回复里用 @${bot.name} 可以提到它。` }], details: { botId: bot.id } };
        },
      });

      pi.registerTool({
        name: 'create_group',
        label: '拉群',
        description:
          '为一件要几个人一起才办得成的事拉一个群聊，用户也在群里。指定成员（名字或 id），可选牵头人（默认你），可以把任务一起丢进群里，也可以只拉群。群里的发言所有成员都看得到，但只有被 @ 的人会被叫醒回答；牵头人负责推进和汇总。结果留在群里这条线上，你和用户都看得到。',
        promptSnippet: '一件事要别人一起才办得成：拉个群，大家和用户在同一条线上（可附任务）',
        promptGuidelines: [
          '一件事里有你办不了、或者办不好的部分，就把人拉进来，别自己硬扛：跨了别人职责的活交给对的人，比你现学一遍更快也更准。',
          '@ 和拉群按「结果要不要回到你手上」选：只是把一件事整个交出去、之后归它跟用户对接，用 @提及；你要拿它的结果接着做、或者这件事得几个人凑齐才交付得了，用 create_group。',
          '拉群不用先问用户，建完在回复里一句话说清拉了谁、各管哪段。summary 写清这件事是什么、做到什么算完，成员才知道怎么配合。',
        ],
        parameters: Type.Object({
          title: Type.String({ description: '群聊名，如「杭州出差」' }),
          members: Type.Array(Type.String(), { description: '成员 bot 的名字或 id（不含你自己也可以，你会自动加入）', minItems: 1 }),
          lead: Type.Optional(Type.String({ description: '牵头 bot 的名字或 id，默认你' })),
          summary: Type.Optional(Type.String({ description: '这件事的一句话描述' })),
          task: Type.Optional(Type.String({ description: '要丢进群里的任务；不填则只拉群' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p) {
          const members = p.members.map((m) => findBot(m)).filter((b): b is Bot => !!b);
          const missing = p.members.filter((m) => !findBot(m));
          if (!members.length) throw new Error(`找不到这些 bot：${missing.join('、')}。用 configure(target=bot, action=get) 看看有哪些。`);
          const lead = (p.lead ? findBot(p.lead) : undefined) ?? c.bot();
          const ids = Array.from(new Set([lead.id, c.botId, ...members.map((b) => b.id)]));
          const matter = await ops().createGroup({ title: p.title, summary: p.summary, memberIds: ids.filter((x) => x !== lead.id), leadId: lead.id, task: p.task, byBotId: c.botId });
          return {
            content: [{ type: 'text', text: `群聊「${matter.title}」已建（id ${matter.id}），成员：${ids.map((x) => c.store.bot(x)?.name).join('、')}，牵头：${lead.name}。${p.task ? '任务已丢进群里。' : ''}${missing.length ? ` 未找到：${missing.join('、')}。` : ''}` }],
            details: { matterId: matter.id },
          };
        },
      });

      pi.registerTool({
        name: 'configure',
        label: '改配置',
        description:
          '读取或修改产品层面的设置——bot 之外、围绕 bot 的东西。target=bot：autonomy(tell|prepare|do 自主度) / notify(消息通知，用户的静音开关；什么时候该找用户是你自己判断，不是这里设的) / pinned(置顶) / avatar(头像：value=regen 重画一张、reset 换回默认、一句外观描述按描述画、或你在工作区生成的 png/jpg 绝对路径直接用作头像)。target=matter：title / summary / members(add|remove bot) / lead / notify / pinned；target=profile：get 查看共享记忆（改动用 remember）。action=get 不带 field 返回完整配置；不带 id 列出全部。\n不收的：你自己的一切——名字、简介、人设、职责与工作方式、技能、例行任务、外部工具、服务、外部 agent、IM 渠道、素材——全用 build；关于用户的记忆用 remember。',
        promptSnippet: '产品设置：通知、置顶、自主度、打扰策略、授权、群聊、连接（bot 自身用 build，记忆用 remember）',
        promptGuidelines: [
          '用户要改产品设置（通知、置顶、自主度、打扰策略、群成员、群名）用 configure 直接改，改完一句话确认，不要只是口头答应。你自己是谁、会什么、能连什么是 build 的事；关于用户的记忆是 remember 的事。',
          '改别的 bot 之前先 configure(action=get) 看清现状；remove 类操作先用 ask_user 确认。',
          '用户想接 IM 渠道、外部工具或外部 agent 时，用 build(aspect=channel/mcp/agent, action=add) 自己接，别让他改配置文件。',
        ],
        parameters: ConfigureParams,
        executionMode: 'sequential',
        async execute(_id, p) {
          const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text }], details });
          const val = p.value as unknown;
          const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

          if (p.target === 'profile') {
            const doc = everos.profileDoc();
            const lines = [...(doc?.explicit ?? []).map((e) => e.description), ...(doc?.traits ?? []).map((e) => `（推断）${e.description}`)];
            if (p.action === 'get') return ok(lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '（画像还没聚出来）');
            throw new Error('画像是引擎从对话里合成的，configure 只读；要记一条事实用 remember');
          }

          if (p.target === 'matter') {
            const m = findMatter(p.id);
            if (p.action === 'get' && !m) return ok(c.store.data.matters.map((x) => `- [${x.id}] ${x.title}：${[x.ownerBotId, ...x.participantBotIds].map((b) => c.store.bot(b)?.name).join('、')}`).join('\n') || '（没有群聊）');
            if (!m) throw new Error('找不到这个群聊');
            if (p.action === 'get') return ok(`id: ${m.id}\n名字: ${m.title}\n描述: ${m.summary}\n牵头: ${c.store.bot(m.ownerBotId)?.name}\n成员: ${m.participantBotIds.map((b) => c.store.bot(b)?.name).join('、')}\n通知: ${m.notify}；置顶: ${m.pinned}`);
            const f = p.field ?? '';
            if (f === 'members') {
              const b = findBot(str(val));
              if (!b) throw new Error('找不到这个 bot');
              const next = p.action === 'remove' ? m.participantBotIds.filter((x) => x !== b.id) : Array.from(new Set([...m.participantBotIds, b.id]));
              c.store.patchMatter(m.id, { participantBotIds: next.filter((x) => x !== m.ownerBotId) });
              return ok(`群「${m.title}」成员已${p.action === 'remove' ? '移除' : '加入'} ${b.name}。`);
            }
            if (f === 'lead') {
              const b = findBot(str(val));
              if (!b) throw new Error('找不到这个 bot');
              c.store.patchMatter(m.id, { ownerBotId: b.id, participantBotIds: Array.from(new Set([m.ownerBotId, ...m.participantBotIds])).filter((x) => x !== b.id) });
              return ok(`「${m.title}」现在由 ${b.name} 牵头。`);
            }
            if (['title', 'summary', 'notify', 'pinned'].includes(f)) {
              c.store.patchMatter(m.id, { [f]: f === 'notify' || f === 'pinned' ? val === true || val === 'true' : str(val) } as Partial<Matter>);
              return ok(`群「${m.title}」的 ${f} 已更新。`);
            }
            throw new Error(`matter 不支持字段 ${f}`);
          }

          // target === 'bot'
          const b = findBot(p.id);
          if (p.action === 'get' && !b) return ok(c.store.data.bots.map((x) => `- [${x.id}] ${x.name}：${x.tagline}`).join('\n'));
          if (!b) throw new Error('找不到这个 bot');
          if (p.action === 'get') return ok(describeBot(b));
          const f = p.field ?? '';
          const patch: Partial<Bot> = {};
          switch (f) {
            case 'name':
            case 'role':
            case 'soul':
            case 'tagline':
            case 'skills':
            case 'routines':
              throw new Error(`${f} 是 bot 自己的事，用 build 改（set 直接写入，rewrite 自己重写）`);
            case 'autonomy':
              if (!['tell', 'prepare', 'do'].includes(str(val))) throw new Error('autonomy 只能是 tell/prepare/do');
              patch.autonomy = str(val) as Bot['autonomy'];
              break;
            case 'notify':
            case 'pinned':
              patch[f] = val === true || val === 'true';
              break;
            case 'avatar': {
              const msg = await ops().avatar(b.id, str(val));
              c.events.emit('crew:bot-configured', { botId: b.id, fields: ['avatar'] });
              return ok(msg, { botId: b.id, avatar: str(val) });
            }
            default:
              throw new Error(`bot 不支持字段「${f}」`);
          }
          c.store.patchBot(b.id, patch);
          c.events.emit('crew:bot-configured', { botId: b.id, fields: Object.keys(patch) });
          return ok(`已更新 ${b.name} 的 ${f}。\n\n${describeBot(c.store.bot(b.id)!)}`, { botId: b.id, patch });
        },
      });
    },
  };
}
