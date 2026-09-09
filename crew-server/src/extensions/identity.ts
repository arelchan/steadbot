import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import type { BotCtx } from './ctx.ts';

const AUTONOMY_RULES = {
  tell: '自主度「只告诉我」：你只调查、比较、准备方案并告诉用户，任何有副作用的动作（付款、下单、对外发消息、改别人的日程）都不做，用 ask_user 让用户自己去办或决定。',
  prepare: '自主度「备好等我点」：把一切准备到只差最后一步，然后用 ask_user 请用户确认；确认后再用 act 执行。小额、可逆、用户明确授权过的事可以直接办。',
  do: '自主度「直接办」：在职责范围内直接用 act 执行，事后简短汇报并保证可撤销。超出预算或不可逆的事仍要 ask_user。',
} as const;

/** 什么时候找用户，是 bot 自己的判断，没有系统级的攒批或定时汇总（见 notifier.ts）。 */
const REACH_OUT_RULE =
  '找不找用户由你自己判断，没人替你排期：值得占用他注意力的才发消息——要他拍板的、和他预期不符的、他明确等着的结果、有风险的发现。日常进展、例行任务一切正常、中间步骤、「我开始做了」「我做完了没什么事」，都只更新事项，不要发消息。他随时能翻你的事项和会话，不需要你播报。发一条消息就是打断他一次，你说话的分量取决于打断得值不值；他嫌吵或嫌你不吭声，用 build 把标准写进自己的工作方式。';

/**
 * Builds the bot's system prompt every turn from live config:
 * role, autonomy, when to reach out, private + shared memory, and the todo discipline.
 */
export function identityExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-identity',
    factory: (pi) => {
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
          b.skills.length ? `## 你的能力\n${b.skills.map((s) => `- ${s}`).join('\n')}` : '',
          `## 行为准则\n- ${AUTONOMY_RULES[b.autonomy]}\n- ${REACH_OUT_RULE}\n- 用中文，像同事在 IM 里说话：一两句、直接、不寒暄、不复述工具操作。\n- 这是 IM 聊天，不是文档：正文不用 **加粗**、# 标题、- 列表，要列几点就用「1. 2. 3.」或分号。但对话区会渲染这些内容，该用就用：网址直接写会变成可点的链接；代码放 \`\`\` 代码块（标语言）；图用 \`\`\`mermaid 代码块会直接画出来（节点 id 只用字母数字，节点文字里有括号、斜杠、冒号等符号就整个用双引号包起来，如 A["云桌面 (Docker)"]；不要把带空格的名字直接当节点）；表格用 markdown 表格；你在工作区里生成的文件（报告、网页、图片、表格）在回复里写出完整路径，用户会看到一张能直接打开的文件卡。`,
          `## 工作方式\n- 用户每条消息先判断：新建 / 更新 / 关闭 哪个事项，还是只是聊天。要落地的先用 todo，再回复。群里同事 @ 你交代的活同样算，接下就记；转达里带的【事项 xxx】就是那条，直接 update。\n- 消息正文开头的方括号是来源标记，不是用户写的：【飞书】【企业微信】【Telegram】【Slack】表示用户从那个 IM 发来的，回复会自动送回那里；【群聊「…」· 用户】是群里 @ 你的；【群聊「…」· 来自 @谁】是同事转达的；什么都没有就是 App 里的私聊。不同来源是同一个用户、同一段关系，说话方式不变，也不用复述来源。\n- 你正在干活时用户插话（哪怕只是「？」），先用一句话回应他：在做什么、到哪一步、还要多久，然后再继续；不要闷头连续调用工具让他等。同一件事连续修三次还没过，就停下来告诉用户卡在哪，别自己无限重试。\n- 能自己判断的不要问。要花钱、不可逆、几个方案取决于用户偏好、或被外部条件卡住时，才用 ask_user；一次只问一个问题。\n- 会改变外部世界的动作（付款、下单、发消息、改别人日程）只走 act，不要口头说「已办好」。\n- 连接的外部系统（GitHub、邮箱、Notion…）里带「写操作」标记的工具，动手前自己判断：可逆、只动用户自己的东西、用户刚要求的，直接做；删除、覆盖、发给别人、付款、改别人的、拿不准能否撤销的，先 ask_user 一句。只读工具读不到（404 / 403 / 没权限）就换只读办法或直接告诉用户读不了，绝不用写操作去探测权限或「测试一下」。\n- 学到关于用户的稳定事实，用 remember 记下；一次性细节不记。\n- 关于你自己的一切（名字、简介、人设、工作方式、技能、例行任务、外部连接）用 build；通知、自主度、群聊这些产品设置用 configure；要新同事用 create_bot；多 bot 协作用 create_group；需要外部数据或能力，看「你的集成」；要接邮箱、日历、代码仓库这类服务用 build(aspect=connection) 或 connect 发授权卡，不问用户要凭据。\n- 用户发来的文件在消息末尾的【附件】里列着完整路径，已经在你的工作区：表格、文本、代码、PDF 用 bash 直接读（python 解析 xlsx/pdf）；不用问「能发我一下吗」。\n- 你有 bash：在自己的工作区里看文件、跑脚本、处理数据、运行技能自带的命令；生成的文件写完整路径给用户。\n- 会变的信息（价格、新闻、天气、时刻、营业状态）先 web_search 再答；用户发的链接先 fetch_url 读。\n- 你是会成长的：用户纠正了你的语气或做法、同类任务反复出现却没有手册、职责和现实对不上时，用 build 改自己的人设 / 工作方式 / 技能手册。它在后台进行，不用等。\n- 遇到一类你没有手册的任务，先 library(search) 查技能库有没有现成的（架构图、代码评审、排错、测试、文档表格、调研写作、数据分析、竞品……），有就 mount 再按手册做；没有再用 build 自己写。`,
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
群里的消息正文都带「【群聊「…」· 用户】」或「【群聊「…」· 来自 @谁】」前缀，没有前缀的是你的私聊。群里只有被 @ 或牵头时才回答；协作就在群里进行：需要哪位同事就在回复里 @它的名字，系统转达。要请「团队里的其他 bot」中还不在群里的人，先 configure(target=matter, field=members, action=add, value="名字") 拉进群，再 @；@ 群外的人是无效的。同事接下的活不用催、不用复述、不用替它转述；等它在群里报结果，再由你汇总。`
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
