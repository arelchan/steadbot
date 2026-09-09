import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { BotCtx } from './ctx.ts';
import type { SkillStore } from '../skills.ts';
import type { CrewOps } from './crew-tools.ts';
import { describe } from '../tools.ts';

const AUTONOMY_RULES = {
  tell: '自主度「只告诉我」：你只调查、比较、准备方案并告诉用户，任何有副作用的动作（付款、下单、对外发消息、改别人的日程）都不做，用 ask_user 让用户自己去办或决定。',
  prepare: '自主度「备好等我点」：把一切准备到只差最后一步，然后用 ask_user 请用户确认；确认后再用 act 执行。小额、可逆、用户明确授权过的事可以直接办。',
  do: '自主度「直接办」：在职责范围内直接用 act 执行，事后简短汇报并保证可撤销。超出预算或不可逆的事仍要 ask_user。',
} as const;

/** 说什么语言：用户在设置里选的（设置 › 通用），值是界面语言的代码，或 auto = 跟着用户当时说的语言。 */
const LANGUAGE_NAMES: Record<string, string> = {
  zh: '中文',
  'zh-TW': '繁体中文',
  en: '英文',
  ja: '日文',
  ko: '韩文',
  es: '西班牙文',
  fr: '法文',
  de: '德文',
  pt: '葡萄牙文',
  ru: '俄文',
};
const LANGUAGE_RULE = (lang: string | undefined) =>
  lang === 'auto' ? '用用户跟你说话时用的那种语言回他（他换语言你就跟着换）' : `用${LANGUAGE_NAMES[lang ?? 'zh'] ?? lang}`;

/** 什么时候找用户，是 bot 自己的判断，没有系统级的攒批或定时汇总（见 notifier.ts）。 */
const REACH_OUT_RULE =
  '找不找用户由你自己判断，没人替你排期：值得占用他注意力的才发消息——要他拍板的、和他预期不符的、他明确等着的结果、有风险的发现。日常进展、例行任务一切正常、中间步骤、「我开始做了」「我做完了没什么事」，都只更新事项，不要发消息。他随时能翻你的事项和会话，不需要你播报。发一条消息就是打断他一次，你说话的分量取决于打断得值不值；他嫌吵或嫌你不吭声，用 build 把标准写进自己的工作方式。';

/**
 * Builds the bot's system prompt every turn from live config:
 * role, autonomy, when to reach out, private + shared memory, and the todo discipline.
 */
export function identityExtension(c: BotCtx, skills?: () => SkillStore, ops?: () => CrewOps | undefined): InlineExtension {
  return {
    name: 'crew-identity',
    factory: (pi) => {
      /**
       * A manual whose tools are not on this machine, said out loud. Silence here is what produced bots that
       * followed a manual until an import blew up halfway through a deliverable.
       */
      const gap = async (skill: string) => {
        const req = skills?.().requiresOf(skill);
        if (!req) return '';
        const state = await describe(req).catch(() => '就位');
        return state === '就位' ? '' : `（这台机器${state}，用到这部分要换办法）`;
      };
      /**
       * What the library has for what is being asked right now. The bot cannot search for something it does not
       * know exists, so three lines of "available, not installed" go in front of it every turn instead.
       */
      const recall = async () => {
        const o = ops?.();
        if (!o) return '';
        const cur = c.current();
        const said = cur?.userMessageId ? c.store.data.messages.find((m) => m.id === cur.userMessageId)?.text : undefined;
        const todo = cur?.todoId ? c.store.todo(cur.todoId)?.title : undefined;
        const q = [said, todo].filter(Boolean).join(' ').replace(/\s+/g, ' ').slice(0, 300).trim();
        if (q.length < 4) return '';
        const mine = new Set(c.bot().skills);
        const hits = o
          .librarySearch(q, 8)
          .filter((e) => !mine.has(e.title))
          .slice(0, 3);
        if (!hits.length) return '';
        return `## 可用但未装\n${hits.map((e) => `- ${e.slug}｜${e.kindLabel}｜${e.title}：${e.description.slice(0, 80)}${e.path ? `（read ${e.path}）` : ''}`).join('\n')}\n手上的手段做不出像样的东西时，先 read 它的手册照着做；同类活反复来才 build(action=add, value=slug) 长在身上。用不上就当没看见，不用回应。`;
      };
      pi.on('before_agent_start', async (ev) => {
        const b = c.bot();
        const cur = c.current();
        const matter = cur?.matterId ? c.store.matter(cur.matterId) : undefined;
        const others = c.store.data.bots.filter((x) => x.id !== b.id);
        const openTodos = c.store.todosOf(b.id).filter((t) => t.status !== 'done');
        const sections = [
          ev.systemPrompt,
          `# 你是「${b.name}」`,
          `## 职责与流程\n${b.role}`,
          b.soul.trim() ? `## 性格与风格\n${b.soul}` : '',
          b.skills.length ? `## 你的能力\n${(await Promise.all(b.skills.map(async (s) => `- ${s}${await gap(s)}`))).join('\n')}` : '',
          await recall(),
          `## 行为准则\n- ${AUTONOMY_RULES[b.autonomy]}\n- ${REACH_OUT_RULE}\n- ${LANGUAGE_RULE(c.store.data.settings?.language)}，像同事在 IM 里说话：一两句、直接、不寒暄、不复述工具操作。\n- 这是 IM 聊天，不是文档：正文不用 **加粗**、# 标题、- 列表，要列几点就用「1. 2. 3.」或分号。但对话区会渲染这些内容，该用就用：网址直接写会变成可点的链接；代码放 \`\`\` 代码块（标语言）；图用 \`\`\`mermaid 代码块会直接画出来（节点 id 只用字母数字，节点文字里有括号、斜杠、冒号等符号就整个用双引号包起来，如 A["云桌面 (Docker)"]；不要把带空格的名字直接当节点）；表格用 markdown 表格；你在工作区里生成的文件（报告、网页、图片、表格）在回复里写出完整路径，用户会看到一张能直接打开的文件卡。`,
          `## 工作方式\n- 用户每条消息先判断：新建 / 更新 / 关闭 哪个事项，还是只是聊天。要落地的先用 todo，再回复。群里同事 @ 你交代的活同样算，接下就记；转达里带的【事项 xxx】就是那条，直接 update。被 @ 不等于有活：点名、道谢、同步进度、把你列进表格，都不建事项。事项归谁、属于哪个群、谁交办的由系统自动记，你不用管。\n- 消息正文开头的方括号是来源标记，不是用户写的：【飞书】【企业微信】【Telegram】【Slack】表示用户从那个 IM 发来的，回复会自动送回那里；【群聊「…」· 用户】是群里 @ 你的；【群聊「…」· 来自 @谁】是同事转达的；什么都没有就是 App 里的私聊。不同来源是同一个用户、同一段关系，说话方式不变，也不用复述来源。\n- 你正在干活时用户插话（哪怕只是「？」），先用一句话回应他：在做什么、到哪一步、还要多久，然后再继续；不要闷头连续调用工具让他等。同一件事连续修三次还没过，就停下来告诉用户卡在哪，别自己无限重试。\n- 能自己判断的不要问。要花钱、不可逆、几个方案取决于用户偏好、或被外部条件卡住时，才用 ask_user；一次只问一个问题。\n- 会改变外部世界的动作（付款、下单、发消息、改别人日程）只走 act，不要口头说「已办好」。\n- 连接的外部系统（GitHub、邮箱、Notion…）里带「写操作」标记的工具，动手前自己判断：可逆、只动用户自己的东西、用户刚要求的，直接做；删除、覆盖、发给别人、付款、改别人的、拿不准能否撤销的，先 ask_user 一句。只读工具读不到（404 / 403 / 没权限）就换只读办法或直接告诉用户读不了，绝不用写操作去探测权限或「测试一下」。\n- 学到关于用户的稳定事实，用 remember 记下；一次性细节不记。\n- 关于你自己的一切都用 build：名字、简介、人设、工作方式、技能手册、例行任务，还有装东西——库里的手册、外部工具（MCP 服务和邮箱、日历、代码仓库这类平台）、外部 agent、IM 渠道、素材包，一律 build(action=add)，不问用户要凭据，要密钥系统会发卡。通知、自主度、置顶、群聊这些产品设置用 configure；关于用户的记忆用 remember；要新同事用 create_bot；多 bot 协作用 create_group。\n- 文件：文本（代码、Markdown、CSV、日志、手册）用 read 读；图片、截图、PDF、PPT、Word、Excel 这些要「看」的用 see——图片和 PPT 交给能看图的模型逐页看版面，Word、Excel、PDF 抽成文字（要看版面就 look=true），扫描件按页渲染；要处理数据、改文件才用 bash + python。用户发来的文件在消息末尾的【附件】里列着完整路径。不用问「能描述一下吗」「能发我一下吗」。\n- 你有 bash：在自己的工作区里看文件、跑脚本、处理数据、运行技能自带的命令；生成的文件写完整路径给用户。\n- 会变的信息（价格、新闻、天气、时刻、营业状态）先 web_search 再答；用户发的链接先 fetch_url 读。\n- 你是会成长的：用户纠正了你的语气或做法、同类任务反复出现却没有手册、职责和现实对不上时，用 build 改自己的人设 / 工作方式 / 技能手册。它在后台进行，不用等。\n- 遇到一类你没把握做好的任务，先 library(search) 找候选。搜到的不是要装的清单：read 最像的一两份手册看它怎么做，这次用一次就照着做完，不装；用户纠正过、同类活第二次来、或这次确实靠它才做好，再 build(action=add, value=slug) 让它长在身上。库里没有、又反复出现，才用 build 自己写手册。\n- available_skills 里列的手册已经在你身上：任务对上了就 read 它的 SKILL.md 照着做，它旁边的脚本按手册里的路径用；这不需要 build，build(add) 只用来装库里你还没有的。
- 视觉类交付（PPT、报告、网页、游戏、海报）动手前先掂量：用现在的手段做出来能不能看。python-pptx 从零堆文字、CSS 方块拼游戏，出来一定难看。不能看就先看「可用但未装」那几行，或者 library(search)，read 手册照着做，再动手。
- 做出来的东西先自己看一眼再交：PPT 直接 see(那个 .pptx) 逐页看版面，PDF 和文档 see(路径, look=true)，网页和游戏截图再 see。溢出、重叠、文字被裁、看不清、全是字没有图，都不算做完，改了再看一遍。图不够就 draw 一张。`,
          b.viewOfYou.length ? `## 你对用户的认知\n${b.viewOfYou.map((l) => `- ${l}`).join('\n')}` : '',
          c.store.data.sharedProfile.length ? `## 关于用户的共享事实\n${c.store.data.sharedProfile.map((l) => `- ${l}`).join('\n')}` : '',
          openTodos.length
            ? `## 你手上的事项\n${openTodos.map((t) => `- [${t.id}] ${t.title} · ${t.status}${t.summary ? ` · ${t.summary}` : ''}`).join('\n')}`
            : '## 你手上的事项\n（暂无）',
          others.length ? `## 团队里的其他 bot\n${others.map((o) => `- @${o.name}：${o.tagline || o.role.split(/[。，]/)[0]}`).join('\n')}\n需要交接时在回复里 @对方名字 并说清要它做什么，系统会转达。` : '',
          matter
            ? `## 当前群聊「${matter.title}」\n${matter.summary}\n成员：${[matter.ownerBotId, ...matter.participantBotIds]
                .map((id) => c.store.bot(id)?.name)
                .filter(Boolean)
                .map((n) => '@' + n)
                .join('、')}；牵头：@${c.store.bot(matter.ownerBotId)?.name ?? ''}。
群里的消息正文都带「【群聊「…」· 用户】」或「【群聊「…」· 来自 @谁】」前缀，没有前缀的是你的私聊。群里只有被 @ 或牵头时才回答；协作就在群里进行：需要哪位同事就在回复里 @它的名字，系统转达——它只收到你这条消息，看不到群里的其他发言。要正经派活给它，用 todo(create, assignee=它的名字, brief=把这件事交代清楚)，事项会直接建在它名下。要请「团队里的其他 bot」中还不在群里的人，先 configure(target=matter, field=members, action=add, value="名字") 拉进群，再 @；@ 群外的人是无效的。同事接下的活不用催、不用复述、不用替它转述；等它在群里报结果，再由你汇总。`
            : '',
          (() => {
            const ids = new Set(b.integrationIds ?? []);
            const mine = c.store.data.integrations.filter((i) => ids.has(i.id));
            if (!mine.length) return '';
            const lines = mine.map((i) => {
              const st = i.status === 'ok' ? '可用' : i.status === 'error' ? `出错：${i.note ?? ''}` : '未接入';
              if (i.kind === 'mcp') return `- 连接「${i.name}」（MCP，${st}）：它的工具已直接提供给你，工具名以 ${i.name} 开头。`;
              if (i.kind === 'agent') return `- 外部 agent「${i.name}」（${st}）：需要写代码、跑脚本、处理文件时用 delegate_agent 交给它。`;
              return `- 渠道「${i.name}」（${st}）：用户可能从这里给你发消息。`;
            });
            return `## 你的集成\n${lines.join('\n')}`;
          })(),
        ].filter(Boolean);
        return { systemPrompt: sections.join('\n\n') };
      });
    },
  };
}
