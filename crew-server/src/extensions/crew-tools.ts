import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { Bot, BuildAspect, BuildJob, Channel, Matter, ThreadId, LibraryEntry } from '../types.ts';

/** Product operations the tools need; implemented in index.ts where the whole system is wired. */
export interface CrewOps {
  /** put the credentials card for one IM into the bot's thread: the bot becomes its own bot over there */
  connectChannel(botId: string, channel: Exclude<Channel, 'app'>, threadId?: ThreadId): void;
  /** take the bot off an IM: stop its account there and forget the credentials */
  disconnectChannel(botId: string, channel: Exclude<Channel, 'app'>): void;
  createBot(brief: string, opts: { name?: string; byBotId: string; task?: string }): Promise<Bot>;
  createGroup(opts: { title: string; summary?: string; memberIds: string[]; leadId: string; task?: string; byBotId: string }): Promise<Matter>;
  addMcp(i: { name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }): Promise<{ id: string; status: string; note?: string; tools?: number }>;
  removeIntegration(id: string): void;
  /** start an asynchronous self-build; resolves as soon as the job is registered */
  build(botId: string, spec: BuildSpec): Promise<BuildJob>;
  /** hand the user an authorization card for a built-in connector (or report it's already connected / unavailable) */
  connect(botId: string, threadId: ThreadId, service: string, why?: string): Promise<{ status: 'connected' | 'card' | 'unavailable' | 'unknown'; text: string }>;
  /** start an asynchronous memory update (consolidated in the background); resolves once registered */
  remember(botId: string, spec: MemorySpec): Promise<BuildJob>;
  /** lexical search over the curated skill library; empty query lists everything */
  librarySearch(query: string, limit?: number): (LibraryEntry & { categoryLabel: string })[];
  /** copy a library skill onto a bot (idempotent) */
  libraryMount(botId: string, slug: string): Promise<{ name: string; already: boolean }>;
  /** steward only: this machine, and the machine the user is moving the bots to (if one was installed) */
  machineStatus(): Promise<MachineStatus>;
  /** the vigil manager, for the vigil (值守) tool */
  vigil(): import('../vigil.ts').VigilManager;
  /** change a bot's avatar: 'regen' | 'reset' | a look description | an image file the bot produced */
  avatar(botId: string, value: string): Promise<string>;
}

export interface MachineStatus {
  here: { hostname: string; platform: string; mode: string; bots: number; local: boolean };
  target?: { name: string; host: string; user: string; connectedAt: number; url?: string; port?: string; pairedAt?: number; reachable?: boolean; note?: string };
}

export interface MemorySpec {
  action: 'add' | 'forget';
  fact: string;
  scope: 'private' | 'shared';
}

export interface BuildSpec {
  aspect: BuildAspect;
  trigger: string;
  change: string;
  skill?: string;
}

const ConfigureParams = Type.Object({
  target: StringEnum(['bot', 'matter', 'profile', 'integration'] as const),
  action: StringEnum(['get', 'set', 'add', 'remove'] as const),
  id: Type.Optional(Type.String({ description: 'bot / 群聊 / 集成 的 id 或名字；缺省为你自己' })),
  field: Type.Optional(
    Type.String({
      description:
        'bot（只有产品层设置）: autonomy(tell|prepare|do) | notify | pinned | integrations | avatar(regen 重画 / reset 用默认 / 一句外观描述 / 你生成的图片文件绝对路径)；matter: title | summary | members | lead | notify | pinned；profile: 只读；integration: 见说明',
    }),
  ),
  value: Type.Optional(Type.Any({ description: 'set 的新值；add/remove 的条目。routines 条目为 {title, schedule}，如 {"title":"扫描发票","schedule":"每天 20:30"}；integration add 为 {name, command|url}' })),
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
      `例行任务: ${b.routines.map((r) => `${r.title}（${r.schedule}${r.enabled ? '' : '，已停用'}）`).join('；') || '（无）'}`,
      `集成: ${integ.join('、') || '（无）'}`,
      `IM: ${
        Object.entries(b.im ?? {})
          .map(([ch, l]) => `${{ feishu: '飞书', telegram: 'Telegram', slack: 'Slack', wechat: '企业微信', app: 'App' }[ch] ?? ch}（${l?.status === 'ok' ? `已接${l.account ? `，那边叫「${l.account}」` : ''}` : l?.status === 'connecting' ? '连接中' : `没接上：${l?.note ?? ''}`}）`)
          .join('；') || '（没接任何 IM；用 configure(field=integrations, action=add, value="飞书") 接）'
      }`,
      `记忆: ${b.viewOfYou.join('；') || '（无）'}`,
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
          '为一件需要多个 bot 持续分工的事拉一个群聊。指定成员（名字或 id），可选牵头人（默认你），可以把任务一起丢进群里，也可以只拉群。群里所有 bot 都能看到对话，@ 谁谁回答。',
        promptSnippet: '为需要多 bot 协作的事拉群（可附任务）',
        promptGuidelines: [
          '两个以上 bot 需要围绕同一件事来回配合时才拉群；一句话能转交的用 @提及 就够了。',
          '拉群时 summary 写清这件事是什么、目标是什么，成员才知道怎么配合。',
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
          '读取或修改产品层面的设置——bot 之外、围绕 bot 的东西。target=bot：autonomy(tell|prepare|do 自主度) / notify(消息通知，用户的静音开关；什么时候该找用户是你自己判断，不是这里设的) / pinned(置顶) / integrations(add|remove 集成名或 id，即授权) / avatar(头像：value=regen 重画一张、reset 换回默认、一句外观描述按描述画、或你在工作区生成的 png/jpg 绝对路径直接用作头像)。名字、简介、人设、职责与工作方式、技能、例行任务属于 bot 自己，用 build 改；关于用户的记忆用 remember 记或忘。这里都不收。target=matter：title / summary / members(add|remove bot) / lead / notify / pinned；target=profile：get 查看共享记忆（改动用 remember）；target=integration：get 列出全部，add value={name,command|url} 新建 MCP 连接，remove 删除连接。action=get 不带 field 返回完整配置；不带 id 列出全部。',
        promptSnippet: '产品设置：通知、置顶、自主度、打扰策略、授权、群聊、连接（bot 自身用 build，记忆用 remember）',
        promptGuidelines: [
          '用户要改产品设置（通知、置顶、自主度、打扰策略、授权集成、群成员、群名）用 configure 直接改，改完一句话确认，不要只是口头答应。名字、简介、人设、工作方式、技能、例行任务是 build 的事；关于用户的记忆是 remember 的事。',
          '改别的 bot 之前先 configure(action=get) 看清现状；remove 类操作先用 ask_user 确认。',
          '用户想接 IM 渠道、MCP 或外部 agent、终端时，先按对应技能文档一步步引导；能替他做的（新建 MCP 连接、授权集成）用 configure 做。',
        ],
        parameters: ConfigureParams,
        executionMode: 'sequential',
        async execute(_id, p) {
          const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text }], details });
          const val = p.value as unknown;
          const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

          if (p.target === 'profile') {
            const lines = c.store.data.sharedProfile;
            if (p.action === 'get') return ok(lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '（共享记忆为空）');
            throw new Error('共享记忆用 remember(scope=shared) 记或忘，configure 只读');
          }

          if (p.target === 'integration') {
            const all = c.store.data.integrations;
            const find = (ref?: string) => (ref ? all.find((i) => i.id === ref || i.name === ref) : undefined);
            const describe = (i: (typeof all)[number]) =>
              `[${i.id}] ${i.name} · ${i.kind}${i.connector ? '（一键连接）' : ''} · ${i.status}${i.note ? ` · ${i.note}` : ''}${i.tools?.length ? ` · 工具：${i.tools.map((t) => t.name).slice(0, 12).join('、')}` : ''}${i.env ? ` · 环境变量：${Object.keys(i.env).join('、')}` : ''}`;
            if (p.action === 'get') {
              const one = find(p.id);
              return ok(one ? describe(one) : all.map(describe).join('\n') || '（没有任何集成）');
            }
            if (p.action === 'add' || p.action === 'set') {
              let v: unknown = val;
              if (typeof v === 'string') {
                try {
                  v = JSON.parse(v);
                } catch {
                  v = { name: p.id ?? 'MCP', command: v };
                }
              }
              const o = (v ?? {}) as { name?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> };
              if (!o.name || (!o.command && !o.url)) throw new Error('add 需要 value={name, command|url, env?}；command 可以带参数，如 "python3 /path/server.py"');
              let command = o.command;
              let args = o.args;
              if (command && !args?.length) {
                const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [command];
                command = parts[0].replace(/"/g, '');
                args = parts.slice(1).map((x) => x.replace(/"/g, ''));
              }
              const r = await ops().addMcp({ name: o.name, command, args, url: o.url, env: o.env });
              return ok(
                r.status === 'ok'
                  ? `已连接「${o.name}」（id ${r.id}），${r.tools ?? 0} 个工具。要给 bot 用：configure(target=bot, field=integrations, action=add, value="${o.name}")。`
                  : `连接「${o.name}」已创建（id ${r.id}），当前状态 ${r.status}：${r.note ?? ''}。凭据还没填的话这是正常的，接着用 request_credentials 发凭据卡；不是凭据问题就检查命令和路径。`,
                { id: r.id, status: r.status },
              );
            }
            if (p.action === 'remove') {
              const i = find(p.id) ?? find(str(val));
              if (!i) throw new Error('找不到这个集成');
              if (i.kind !== 'mcp') throw new Error('渠道、外部 agent、终端是内置的，不能删，只能取消授权');
              ops().removeIntegration(i.id);
              return ok(`已删除连接「${i.name}」。`);
            }
            throw new Error('integration 只支持 get / add / remove');
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
            case 'integrations': {
              const ref = str(val);
              const i = c.store.data.integrations.find((x) => x.id === ref || x.name === ref);
              if (!i) throw new Error(`找不到集成「${ref}」；configure(target=integration, action=get) 可以列出全部`);
              if (i.kind === 'channel' && i.channel && i.channel !== 'app') {
                // An IM is not granted, it is joined: the bot gets its own account there, credentials via a card.
                if (p.action === 'remove') {
                  ops().disconnectChannel(b.id, i.channel);
                  return ok(`${b.name} 已从${i.name}断开。`, { botId: b.id, channel: i.channel });
                }
                if (b.im?.[i.channel]?.status === 'ok') return ok(`${b.name} 已经在${i.name}上了${b.im[i.channel]?.account ? `，那边叫「${b.im[i.channel]!.account}」` : ''}。`, { botId: b.id, channel: i.channel });
                ops().connectChannel(b.id, i.channel, c.current()?.threadId);
                return ok(`凭据卡已发到对话里：用户按卡上的步骤在${i.name}里给 ${b.name} 建一个机器人，凭据填在卡上，填完系统会自动接上并通知你。现在不要追问，也不要让他改配置文件。`, { botId: b.id, channel: i.channel });
              }
              const cur = b.integrationIds ?? [];
              patch.integrationIds = p.action === 'remove' ? cur.filter((x) => x !== i.id) : Array.from(new Set([...cur, i.id]));
              break;
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
