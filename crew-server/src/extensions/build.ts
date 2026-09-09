import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { CHANNEL_LABEL, type Bot, type Channel } from '../types.ts';
import { IMS } from '../channels.ts';
import { join } from 'node:path';
import { config } from '../config.ts';
import type { SkillStore } from '../skills.ts';

const CHANNEL_ALIAS: Record<string, Channel> = { 应用: 'app', 应用内: 'app', App: 'app', app: 'app', 飞书: 'feishu', 企业微信: 'wechat', 微信: 'wechat', Slack: 'slack', slack: 'slack', Telegram: 'telegram', telegram: 'telegram', 电报: 'telegram' };

type Details = { jobId?: string; aspect: string; action: string; label?: string };

/** Aspects that are things to acquire rather than text to write. */
const EQUIPPABLE = ['skill', 'mcp', 'service', 'agent', 'channel', 'assets'];

/**
 * build: everything the bot is and has. Who it is (name, tagline, soul, instructions), what it knows (skills,
 * routines) and what it can reach (MCP servers, one-click services, external agents, IM channels, asset packs).
 * One door on purpose — a bot builds itself, and splitting "write a manual" from "install the thing the manual
 * needs" is what left bots holding manuals they could not run.
 *   rewrite  (default, text aspects) the bot rewrites it itself, asynchronously, from what happened
 *   set      apply an exact value right away
 *   add      equip something: a pool slug, or a hand-written MCP connection
 *   remove   drop it
 * The only thing that is not build's: what it knows about the user (remember), and product settings like notify,
 * autonomy, pinning and groups (configure).
 */
export function buildExtension(c: BotCtx, skills: () => SkillStore, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-build',
    factory: (pi) => {
      pi.registerTool({
        name: 'build',
        label: '进化',
        description:
          '构建你自己：你是谁、你会什么、你能连什么，全在这里。\n文字类（action=rewrite 自省重写 / set 原样写入）：name 名字、tagline 简介、soul 人设、instructions 职责与工作方式、skill 技能手册、routine 例行任务。\n装配类（action=add 装上 / remove 卸掉）：skill 把库里一份手册长在身上（value=库里的 slug）；mcp 接一个外部工具（value=库里的 slug——MCP 服务或 Gmail、GitHub、Notion 这类一键登录的平台都在库里；库里没有的才自己写 {name, command|url, env?}）；service 同 mcp，value=平台 slug；agent 用一个外部编程 agent（value=claude-code / codex / hermes / opencode / openclaw）；channel 让自己上一个 IM（value=飞书 / 企业微信 / Slack / Telegram，会给用户发凭据卡）；assets 下载一个素材包（value=库里的 slug）。\n装之前先 library(search) 找候选、read 过手册再定：搜到不等于要装，用一次就照着手册做，值得长在身上的才 add。适用：用户纠正了你的做法；同类任务第二次出现；手上的手段做不出像样的东西、库里那份能；用户直接要你改名、加定时任务、接某个服务。不适用：只影响这一次的临时要求（直接照做）；关于用户的事实（remember）；通知、自主度、置顶、群聊（configure）。',
        promptSnippet: '构建你自己：名字 / 人设 / 工作方式 / 技能 / 例行任务，以及装外部工具、接服务、接 IM、下素材包（add）',
        promptGuidelines: [
          'rewrite 要有依据：用户明确纠正过，或同类情况至少出现两次。一句夸奖、一次偶然，不足以改。',
          '一次只改一个方面。trigger 写清发生了什么、哪句话；change 写清要变成什么样，具体到能直接落笔。',
          '用户给的是原话（「把人设改成：…」「叫你小张」）用 set 原样写入；给的是方向（「别这么客气」「以后先给结论」）用 rewrite 自己重写。',
          'rewrite 调用后照常继续手上的事，不要等结果；回复里最多带半句「我顺手把自己的…调一下」，用户不问就不展开。',
          'skill：技能名沿用已有的表示改写，新名字表示新建；手册是写给以后的你看的操作步骤。routine 的 schedule 只认「每天 20:30」「每周一 09:00」「工作日 18:00」「每 30 分钟」「每小时」这几种写法；用户说「这条只发 Telegram」就带上 channels。',
          '装东西一条路：library(search) 找到候选，read 手册看值不值，再 build(action=add, value=slug)——手册、外部工具、素材包都这样。搜到不等于要装：这次用一次就照着手册做完，同类活反复来才装。装的时候依赖会自动装好，装不上会明说缺什么。',
          '装完直接接着干活，不用向用户汇报「我装了什么」；要密钥的会自动发卡，用户填完系统通知你，不要追问。',
          '这一轮装了两样以上、把一件以前做不了的事做成了，而库里没有讲这个组合的手册，就 build(aspect=skill, rewrite) 写一份：什么场景、用哪几样、怎么验证。只装了一份现成手册照着做的不用写。',
        ],
        parameters: Type.Object({
          aspect: StringEnum(['name', 'tagline', 'soul', 'instructions', 'skill', 'routine', 'mcp', 'service', 'agent', 'channel', 'assets'] as const),
          action: Type.Optional(StringEnum(['rewrite', 'set', 'add', 'remove'] as const)),
          trigger: Type.Optional(Type.String({ description: 'rewrite：发生了什么让你想改，引用用户的原话或具体事件' })),
          change: Type.Optional(Type.String({ description: 'rewrite：要变成什么样——保留什么、改掉什么、新增什么' })),
          value: Type.Optional(Type.Any({ description: 'set：新值（name/tagline/soul/instructions 为字符串；routine 为 {title, schedule, enabled?, channels?}，channels 如 ["app"]、["telegram"]、["app","飞书"]，不填就发到你在的每个地方）。add：库里的 slug、平台 slug、agent 名、IM 名，或自己写的 MCP {name, command|url, env?}' })),
          skill: Type.Optional(Type.String({ description: 'aspect=skill 时的技能名；aspect=routine 且 remove 时可用作任务标题' })),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'rewrite';
          const b = c.bot();
          const str = (v: unknown) => {
            if (typeof v !== 'string' || !v.trim()) throw new Error('value 需要是非空字符串');
            return v.trim();
          };
          const done = (text: string, extra: Partial<Details> = {}) => ({ content: [{ type: 'text' as const, text }], details: { aspect: p.aspect, action, ...extra } as Details });

          if (action === 'rewrite') {
            if (!['soul', 'instructions', 'skill'].includes(p.aspect))
              throw new Error(`${p.aspect} 不能 rewrite，请用 ${EQUIPPABLE.includes(p.aspect) ? 'action=add（value 填 slug）' : 'set 给出具体值'}`);
            if (!p.trigger?.trim() || !p.change?.trim()) throw new Error('rewrite 需要 trigger 和 change');
            if (p.aspect === 'skill' && !p.skill?.trim()) throw new Error('aspect=skill 需要 skill 技能名');
            const job = await ops().build(c.botId, { aspect: p.aspect as 'soul' | 'instructions' | 'skill', trigger: p.trigger, change: p.change, skill: p.skill?.trim() });
            return done(`已开始进化「${job.label}」，后台进行，不影响当前对话；完成后用户会看到通知。你继续手上的事。`, { jobId: job.id, label: job.label });
          }

          const cur = c.current();
          const threadId = cur?.threadId ?? (`bot:${c.botId}` as const);

          if (EQUIPPABLE.includes(p.aspect)) {
            const ref = str(p.value ?? p.skill);
            if (action === 'remove') {
              if (p.aspect === 'channel') {
                const ch = c.store.data.integrations.find((x) => x.kind === 'channel' && (x.name === ref || x.channel === ref));
                if (!ch?.channel || ch.channel === 'app') throw new Error(`没有叫「${ref}」的渠道`);
                ops().disconnectChannel(c.botId, ch.channel);
                return done(`已从${ch.name}断开。`);
              }
              const i = c.store.data.integrations.find((x) => x.id === ref || x.name === ref || x.connector === ref.toLowerCase() || x.agent === ref);
              if (!i) throw new Error(`没有叫「${ref}」的连接`);
              c.store.patchBot(c.botId, { integrationIds: (b.integrationIds ?? []).filter((x) => x !== i.id) });
              return done(`已断开 ${i.name}，它的工具不再出现在你的列表里。`);
            }
            if (action !== 'add' && action !== 'set') throw new Error(`${p.aspect} 只支持 add / remove`);

            if (p.aspect === 'service') {
              const r = await ops().connect(c.botId, threadId, ref, p.trigger);
              return done(r.text, { label: ref });
            }
            if (p.aspect === 'channel') {
              const ch = c.store.data.integrations.find((x) => x.kind === 'channel' && (x.name === ref || x.channel === ref));
              if (!ch?.channel || ch.channel === 'app') throw new Error(`没有叫「${ref}」的 IM 渠道；可以接的是：${c.store.data.integrations.filter((x) => x.kind === 'channel' && x.channel !== 'app').map((x) => x.name).join('、')}`);
              if (b.im?.[ch.channel]?.status === 'ok') return done(`你已经在${ch.name}上了${b.im[ch.channel]?.account ? `，那边叫「${b.im[ch.channel]!.account}」` : ''}。`);
              ops().connectChannel(c.botId, ch.channel, threadId);
              return done(`凭据卡已发到对话里：用户按卡上的步骤在${ch.name}里给你建一个机器人，填完系统会自动接上并通知你。现在不要追问，也不要让他改配置文件。`, { label: ch.name });
            }
            if (p.aspect === 'agent') {
              const i = c.store.data.integrations.find((x) => x.kind === 'agent' && (x.agent === ref || x.name === ref || x.name.toLowerCase() === ref.toLowerCase()));
              if (!i) throw new Error(`没有叫「${ref}」的外部 agent；这台机器上有的是：${c.store.data.integrations.filter((x) => x.kind === 'agent').map((x) => x.name).join('、') || '（一个都没有）'}`);
              if (i.available === false) return done(`${i.name} 没装在这台机器上${i.loginHint ? `（装好后还要：${i.loginHint}）` : ''}，接不上。换一个，或者告诉用户。`);
              await ops().grant(c.botId, i.id);
              return done(`${i.name} 已经归你用了${i.acp ? '（能看到它干活的过程）' : ''}，用 delegate_agent 把活交给它。`, { label: i.name });
            }
            // skill / mcp / assets: a pool slug, or — for mcp only — a connection written out by hand
            if (p.aspect === 'mcp' && (typeof p.value === 'object' || /[\s{]/.test(ref))) {
              let v: unknown = p.value;
              if (typeof v === 'string') {
                try {
                  v = JSON.parse(v);
                } catch {
                  v = { name: p.skill ?? 'MCP', command: v };
                }
              }
              const o = (v ?? {}) as { name?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> };
              if (!o.name || (!o.command && !o.url)) throw new Error('自己写连接要 value={name, command|url, env?}；command 可以带参数，如 "python3 /path/server.py"。库里有现成的就用 build(add, value=slug)');
              let command = o.command;
              let args = o.args;
              if (command && !args?.length) {
                const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [command];
                command = parts[0].replace(/"/g, '');
                args = parts.slice(1).map((x) => x.replace(/"/g, ''));
              }
              const r = await ops().addMcp({ name: o.name, command, args, url: o.url, env: o.env });
              await ops().grant(c.botId, r.id);
              if (r.status === 'ok') return done(`「${o.name}」接好了，${r.tools ?? 0} 个工具已经在你的列表里。`, { label: o.name });
              return done(`「${o.name}」连接建好了（id ${r.id}），状态 ${r.status}：${r.note ?? ''}。缺凭据就用 request_credentials 发卡；不是凭据问题就检查命令和路径。`, { label: o.name });
            }
            if (p.aspect === 'skill') {
              // The model sees its own manuals listed by pi slug (s-xxxx) and reaches for build to "load" one. Nothing to
              // install: point it at the file.
              const owned = b.skills.find((n) => n === ref || skills().slugFor(n) === ref);
              if (owned) return done(`「${owned}」已经在你身上，不用装。手册在 ${join(config.piAgentDir, 'skills', skills().slugFor(owned), 'SKILL.md')}，read 它照着做。`, { label: owned });
            }
            const r = await ops().equip(c.botId, ref, threadId);
            return done(r.text, { label: ref });
          }

          const patch: Partial<Bot> = {};
          switch (p.aspect) {
            case 'name':
              if (action === 'remove') throw new Error('名字不能删');
              patch.name = str(p.value).slice(0, 12);
              break;
            case 'tagline':
              patch.tagline = action === 'remove' ? '' : str(p.value).slice(0, 40);
              break;
            case 'soul':
              patch.soul = action === 'remove' ? '' : str(p.value).slice(0, 400);
              break;
            case 'instructions':
              if (action === 'remove') throw new Error('职责不能删空，请改写');
              patch.role = str(p.value).slice(0, 800);
              break;
            case 'skill': {
              const name = (p.skill ?? (typeof p.value === 'string' ? p.value : '')).trim();
              if (!name) throw new Error('需要 skill 技能名');
              if (action === 'remove') patch.skills = b.skills.filter((s) => s !== name);
              else throw new Error('技能手册不能 set 原文，请用 rewrite 让自己写一份');
              break;
            }
            case 'routine': {
              if (action === 'remove') {
                const t = (typeof p.value === 'string' ? p.value : (p.value as { title?: string })?.title) ?? p.skill;
                if (!t) throw new Error('remove routine 需要任务标题');
                patch.routines = b.routines.filter((r) => r.title !== t && r.id !== t);
              } else {
                const v = p.value as { title?: string; schedule?: string; enabled?: boolean; channels?: string[] } | undefined;
                if (!v?.title || !v?.schedule) throw new Error('set routine 需要 value={title, schedule}，schedule 如「每天 20:30」「每周一 09:00」「工作日 18:00」「每 30 分钟」');
                // Where the result goes. 'app' is always available; an IM only if this bot is actually on it.
                const here: Channel[] = ['app', ...IMS.filter((ch) => b.im?.[ch]?.status === 'ok')];
                const channels = v.channels?.length
                  ? v.channels.map((raw) => {
                      const want = String(raw).trim().toLowerCase();
                      const ch = here.find((x) => x === want || CHANNEL_ALIAS[String(raw).trim()] === x);
                      if (!ch) throw new Error(`发不到「${raw}」。现在能发的是：${here.map((x) => CHANNEL_LABEL[x]).join('、')}${here.length === 1 ? '（要发到 IM，先 build(aspect=channel, action=add)）' : ''}`);
                      return ch;
                    })
                  : undefined;
                const existing = b.routines.find((r) => r.title === v.title);
                patch.routines = existing
                  ? b.routines.map((r) => (r.title === v.title ? { ...r, schedule: v.schedule!, enabled: v.enabled ?? r.enabled, channels: channels ?? r.channels } : r))
                  : [...b.routines, { id: Math.random().toString(36).slice(2, 10), title: v.title, schedule: v.schedule, enabled: v.enabled ?? true, ...(channels ? { channels } : {}) }];
              }
              break;
            }
          }
          c.store.patchBot(c.botId, patch);
          const what = { name: '名字', tagline: '简介', soul: '人设', instructions: '工作方式', skill: '技能', routine: '例行任务', mcp: '外部工具', service: '服务', agent: '外部 agent', channel: '渠道', assets: '素材包' }[p.aspect];
          return done(`${what}已${action === 'remove' ? '去掉' : '更新'}。界面上已经生效。`);
        },
      });
    },
  };
}
