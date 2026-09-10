/**
 * AgentService is the seam where a real backend (OpenClaw / any agent framework) plugs in.
 * The UI only calls these three methods and listens to the store.
 * MockAgentService simulates bots with timers so the frontend can be exercised end to end.
 */
import { wsUrl, httpBase, authHeaders } from './runtime';
import type { Bot, Channel, Pending, ThreadId, TodoStatus, FileRef } from '../types';
import { WsAgentService } from './ws-agent';
import { AUTONOMY_LABEL, botThread, matterThread, parseThread } from '../types';
import { t } from '../i18n';
import { showIdentity,
  addAction,
  addBot,
  addMessage,
  select,
  addPending,
  addTodo,
  getState,
  patchMessage,
  patchTodo,
  pushToast,
  resolvePending,
  setState,
  setTyping,
} from '../store';

export interface AgentService {
  onUserMessage(threadId: ThreadId, text: string, via?: Channel, files?: FileRef[]): void;
  /** Move this runtime's home to another server (paired by code). Resolves when the other side has it. */
  migrateTo(url: string, token: string, force?: boolean, onProgress?: (sent: number, total: number) => void): Promise<void>;
  /** Have the local server install crew-server on a remote Linux machine over ssh; streams log lines; resolves with the pairing code. */
  remoteInstall(opts: { host: string; user: string; password?: string; domain?: string }, onLog: (line: string) => void): Promise<{ code: string; url: string }>;
  /** Summon the steward (the product's bot for "where do the bots live"); resolves with its bot id after it has been handed the first sentence. */
  startSteward(intent: 'move_out'): Promise<string>;
  /** Connection card submitted: values go to the local server only. */
  machineConnect(messageId: string, o: { host: string; user: string; password: string; port?: number }): void;
  /** Move card clicked. */
  machineMove(messageId: string): void;
  /** 新 bot 空窗口里的第一条消息：由这句话生成 bot，然后照常处理这句话。 */
  onDraftMessage(text: string): void;
  onPendingChoice(pendingId: string, optionId: string): void;
  /** 凭据卡提交：值只发给后端，不进本地状态 */
  submitSecrets(messageId: string, integrationId: string, values: Record<string, string>): void;
  submitLogin(messageId: string, askId: string, values: Record<string, string>): void;
  /** 把一个 bot 接到某个 IM：后端往它的会话里发凭据卡；它在那边会是一个独立的机器人 */
  connectChannel(botId: string, channel: Channel): void;
  /** 把一个 bot 从某个 IM 断开：停掉那边的机器人，删掉凭据 */
  disconnectChannel(botId: string, channel: Channel): void;
  /** 唤醒 / 休眠 bot 们共用的电脑 */
  computerPower(on: boolean): void;
  start(): void;
  stop(): void;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const clean = (t: string) => t.replace(/[。！？!?，,、\s]+$/g, '').trim();
/** Turn a user's sentence into a short task title: drop politeness, keep the first clause. */
const summarize = (t: string) => {
  let c = clean(t).replace(/^(帮我|请|麻烦|你|能不能|可以)+/, '').replace(/^(帮我|请|麻烦)+/, '');
  const first = c.split(/[，,；;。]/)[0];
  if (first.length >= 6) c = first;
  c = c.replace(/(一下|下|吧|呗|哈|啊|呢|好吗|行吗)$/, '');
  return c.length > 22 ? c.slice(0, 22) + '…' : c;
};

function botsIn(threadId: ThreadId): { primary: Bot; others: Bot[]; matterId?: string } {
  const s = getState();
  const { kind, id } = parseThread(threadId);
  if (kind === 'bot') {
    const b = s.bots.find((x) => x.id === id)!;
    return { primary: b, others: [] };
  }
  const m = s.matters.find((x) => x.id === id)!;
  const owner = s.bots.find((b) => b.id === m.ownerBotId)!;
  const others = s.bots.filter((b) => m.participantBotIds.includes(b.id) && b.id !== owner.id);
  return { primary: owner, others, matterId: m.id };
}

function openTodoFor(botId: string, matterId?: string) {
  const s = getState();
  return s.todos
    .filter((t) => t.botId === botId && t.status !== 'done' && (matterId ? t.matterId === matterId : true))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/**
 * A bot chose to speak, so it is reaching out: that is a toast. Whether something was worth saying is the bot's
 * own judgement, not a system-level dial. The only mutes here are the user's own (bot / group 通知开关).
 */
function notify(bot: Bot, threadId: ThreadId, text: string, kind: 'normal' | 'blocked' = 'normal') {
  const s = getState();
  if (s.selection === threadId) return; // user is already looking
  if (!bot.notify && kind !== 'blocked') return; // 消息通知关掉了：只留角标
  const { kind: tk, id: tid } = parseThread(threadId);
  if (tk === 'matter' && kind !== 'blocked' && s.matters.find((m) => m.id === tid)?.notify === false) return;
  pushToast({ botId: bot.id, text, threadId });
}

async function botSays(
  bot: Bot,
  threadId: ThreadId,
  text: string,
  extra: Partial<Parameters<typeof addMessage>[0]> = {},
  delay = 900 + Math.random() * 700,
) {
  setTyping(threadId, bot.id, true);
  await wait(delay);
  setTyping(threadId, bot.id, false);
  const m = addMessage({ threadId, author: 'bot', botId: bot.id, text, ts: Date.now(), ...extra });
  if (extra.todoId) patchTodo(extra.todoId, { summary: text.length > 48 ? text.slice(0, 48) + '…' : text });
  notify(bot, threadId, text.length > 60 ? text.slice(0, 60) + '…' : text, extra.card?.type === 'blocked' ? 'blocked' : 'normal');
  return m;
}

/* -------- offers: the autonomy dial decides how far a bot goes -------- */

interface Offer {
  title: string;
  sub: string;
  amount: number;
  todoId?: string;
  matterId?: string;
  paidText: string;
  actionText: string;
}

async function offer(bot: Bot, threadId: ThreadId, o: Offer, lead: string) {
  if (bot.autonomy === 'do') {
    const m = await botSays(bot, threadId, `${lead}${o.paidText} 2 小时内可撤销，我记在日志里了。`, { status: '直接办了', todoId: o.todoId });
    addAction({ botId: bot.id, matterId: o.matterId, todoId: o.todoId, text: `${o.actionText} ¥${o.amount}`, undoable: true });
    if (o.todoId) patchTodo(o.todoId, { status: 'done', result: `${o.title}，¥${o.amount}，已付款（直接办）。` });
    return m;
  }
  if (bot.autonomy === 'tell') {
    const msgId = Math.random().toString(36).slice(2, 10);
    const p = addPending({
      botId: bot.id, threadId, matterId: o.matterId, todoId: o.todoId, kind: 'clarify', title: o.title, detail: o.sub, amount: o.amount, messageId: msgId,
      options: [
        { id: 'go', label: '你去订', primary: true },
        { id: 'later', label: '先放着' },
      ],
    });
    await botSays(bot, threadId, `${lead}${o.title}，¥${o.amount}。按你的设置我只告诉你，不动手。要我去订吗？`, {
      id: msgId, status: '等你', todoId: o.todoId,
      card: { type: 'options', pendingId: p.id, options: [
        { id: 'go', label: '你去订', hint: `¥${o.amount} · 订好后付款前再问你` },
        { id: 'later', label: '先放着', hint: '有变化再叫我' },
      ] },
    });
    if (o.todoId) patchTodo(o.todoId, { status: 'waiting' });
    return;
  }
  // prepare
  const msgId = Math.random().toString(36).slice(2, 10);
  const p = addPending({
    botId: bot.id, threadId, matterId: o.matterId, todoId: o.todoId, kind: 'confirm', title: o.title, detail: o.sub, amount: o.amount, messageId: msgId,
    options: [
      { id: 'pay', label: '确认付款', primary: true },
      { id: 'switch', label: '换一个' },
      { id: 'later', label: '先放着' },
    ],
  });
  await botSays(bot, threadId, `${lead}订单填好了，停在付款这一步。`, {
    id: msgId, status: '等你', todoId: o.todoId,
    card: { type: 'confirm', pendingId: p.id, title: o.title, sub: o.sub, amount: o.amount },
  });
  if (o.todoId) patchTodo(o.todoId, { status: 'waiting' });
}

/* -------- scenarios -------- */

const TRAINS = [
  { id: 'g7301', label: 'G7301 · 07:15 → 08:20', hint: '二等 ¥73 · 余 40+', price: '¥73' },
  { id: 'g7317', label: 'G7317 · 08:00 → 09:05', hint: '二等 ¥73 · 余 12', price: '¥73' },
  { id: 'g7333', label: 'G7333 · 09:00 → 10:05', hint: '二等 ¥73 · 余 40+', price: '¥73' },
];

async function tripScenario(bot: Bot, threadId: ThreadId, text: string, todoId?: string, matterId?: string) {
  if (/一等/.test(text)) {
    const s = getState();
    const openConfirm = s.pendings.find((p) => !p.resolved && p.botId === bot.id && p.kind === 'confirm' && p.threadId === threadId);
    if (openConfirm) resolvePending(openConfirm.id, '改一等座');
    await offer(bot, threadId, {
      title: 'G7317 · 08:00 上海虹桥 → 09:05 杭州东 · 一等座', sub: '余 5 张 · 支付宝 Agent 支付，会弹到你手机确认', amount: 117, todoId, matterId,
      paidText: '同一班一等座 ¥117 付好了。', actionText: '付款 G7317 一等座',
    }, '好，同一班一等座 ¥117，余 5 张，');
    return true;
  }
  if (/票|高铁|火车|机票|航班|去.*(开会|出差)/.test(text)) {
    await botSays(bot, threadId, `收到。我理解为：${clean(text)}。从上海出发，二等座优先，和之前一样。我先比班次不买，理解有误直接回我一句。`, { todoId });
    if (todoId) patchTodo(todoId, { status: 'doing' });
    addAction({ botId: bot.id, matterId, todoId, text: '查 12306 和携程，比了 3 班' });
    await wait(2200);
    const msgId = Math.random().toString(36).slice(2, 10);
    const p = addPending({
      botId: bot.id, threadId, matterId, todoId, kind: 'clarify', title: '选哪班车', detail: TRAINS.map((t) => t.label).join(' / '), messageId: msgId,
      options: TRAINS.map((t, i) => ({ id: t.id, label: t.label.split(' · ')[1], primary: i === 1 })),
    });
    await botSays(bot, threadId, '比了三班，都是 ¥73。按你不坐 7 点前的习惯，我倾向 8:00 那班。你点一个，我去填单。', {
      id: msgId, status: '等你', todoId, card: { type: 'options', pendingId: p.id, options: TRAINS },
    }, 600);
    if (todoId) patchTodo(todoId, { status: 'waiting' });
    return true;
  }
  if (/酒店|住/.test(text)) {
    const msgId = Math.random().toString(36).slice(2, 10);
    const p = addPending({
      botId: bot.id, threadId, matterId, todoId, kind: 'clarify', title: '酒店住哪边', detail: '会场附近 ¥420 / 西湖边 ¥488', messageId: msgId,
      options: [
        { id: 'near', label: '会场附近', primary: true },
        { id: 'lake', label: '西湖边' },
      ],
    });
    addAction({ botId: bot.id, matterId, todoId, text: '在携程比了 6 家酒店' });
    await botSays(bot, threadId, '会场在滨江。你要住会场附近，还是像上次一样住西湖边？两个都在 ¥500 标准内。', {
      id: msgId, status: '等你', todoId,
      card: { type: 'options', pendingId: p.id, options: [
        { id: 'near', label: '会场附近 · 步行 5 分钟', hint: '¥420/晚 · 携程', price: '¥420' },
        { id: 'lake', label: '西湖边 · 你上次住的', hint: '¥488/晚 · 打车到会场 25 分钟', price: '¥488' },
      ] },
    });
    if (todoId) patchTodo(todoId, { status: 'waiting' });
    return true;
  }
  return false;
}

async function billScenario(bot: Bot, threadId: ThreadId, text: string, todoId?: string, matterId?: string) {
  if (/报销|发票/.test(text)) {
    await botSays(bot, threadId, '好，归进"9 月报销"。发票到了我填进飞书报销单，周五提交前找你签。抬头默认用公司的。', { todoId });
    if (todoId) patchTodo(todoId, { status: 'doing' });
    addAction({ botId: bot.id, matterId, todoId, text: '归集进"9 月报销"' });
    return true;
  }
  if (/续|订阅|扣款|退订/.test(text)) {
    await botSays(bot, threadId, '我现在盯着 6 个订阅，下一个到期的是腾讯视频（9/8）。你想让我怎么处理没用过的订阅：到期问你，还是直接停？');
    return true;
  }
  return false;
}

async function sentinelScenario(bot: Bot, threadId: ThreadId, text: string, todoId?: string) {
  if (/全部|都看|剩下/.test(text)) {
    await botSays(bot, threadId, '其余 83 条按来源归档在"昨日全部"里了，我在右栏放了入口。下次摘要如果你想多看几条，回我"多挑几条"就行。');
    return true;
  }
  if (/盯|关注|留意|监控/.test(text)) {
    await botSays(bot, threadId, `好，加进监控名单：${summarize(text)}。日常有动静我自己记着，真正重要的立刻告诉你。`, { todoId });
    if (todoId) patchTodo(todoId, { status: 'doing' });
    addAction({ botId: bot.id, todoId, text: `加进监控名单：${summarize(text)}` });
    return true;
  }
  return false;
}

async function genericScenario(bot: Bot, threadId: ThreadId, text: string, todoId?: string, matterId?: string) {
  const mode = AUTONOMY_LABEL[bot.autonomy];
  await botSays(bot, threadId, `收到，记下了：${summarize(text)}。我先去看，${bot.autonomy === 'do' ? '能办的直接办' : `按"${mode}"来`}，有结果或卡住了再找你。`, { todoId });
  if (todoId) patchTodo(todoId, { status: 'doing' });
  await wait(2500 + Math.random() * 1500);
  addAction({ botId: bot.id, matterId, todoId, text: `查了相关信息：${summarize(text)}` });
  if (todoId) patchTodo(todoId, { summary: '查到了，正在整理' });
  await wait(2500 + Math.random() * 1500);
  addAction({ botId: bot.id, matterId, todoId, text: `完成：${summarize(text)}` });
  if (todoId) patchTodo(todoId, { status: 'done', result: `已完成：${summarize(text)}。没有花钱、没有对外发消息，全部动作见经过。` });
  await botSays(bot, threadId, `做完了：${summarize(text)}。过程在右栏这条事项里，没有需要你拍板的地方。`, { status: '已完成', todoId }, 400);
}

/* -------- inferring a bot from the first sentence -------- */

const BOT_TEMPLATES: { re: RegExp; name: string; glyph: string; role: string; soul: string; skills: string[] }[] = [
  { re: /会议|开会|日程|约.*时间|挪|提醒我/, name: '日程协调', glyph: '日', role: '帮我约时间、挪会、发会前提醒。改别人的会之前问我。', soul: '利落、有条理，像一个资深行政。报时间地点不废话；动别人的日程时先替用户把面子和分寸想周全。', skills: ['读写飞书日历', '找共同空闲', '会前提醒'] },
  { re: /学|背|练|课/, name: '学习教练', glyph: '学', role: '把我想学的东西拆成每天一小段，晚上问我一句今天学了没。', soul: '温和但不纵容，像一个好的私教。鼓励多于说教，用户偷懒时点到为止，不上价值。', skills: ['拆解学习计划', '每日打卡', '间隔复习'] },
  { re: /水电|快递|买|补货|日用品|家里/, name: '家务管家', glyph: '家', role: '盯水电煤缴费、快递到了提醒我、日用品快用完了列清单。¥200 以内直接买。', soul: '踏实、贴心、话少。像家里那个默默把事都办好的人，只在需要用户拿主意时开口。', skills: ['缴费提醒', '快递追踪', '补货清单'] },
  { re: /运动|睡|体检|健身|跑步|减/, name: '健康搭子', glyph: '健', role: '记我的运动和睡眠，体检该约了提醒我。不说教，一周最多催两次。', soul: '轻松、像朋友，不像医生。不说教、不吓人，用户没做到也不责备。', skills: ['运动记录', '睡眠回顾', '体检预约'] },
  { re: /写|文章|稿|公众号|素材|选题/, name: '写作助手', glyph: '写', role: '我随手丢的素材归到对应的选题里，需要时给我出初稿，不替我定观点。', soul: '克制、有品味，尊重用户的观点和表达习惯。给意见时直说好在哪、弱在哪，不夸不捧。', skills: ['素材归集', '初稿', '改稿'] },
  { re: /盯|关注|留意|监控|竞品|动态/, name: '信息哨兵', glyph: '哨', role: '盯我关心的人和事，每天一份摘要，真正重要的才立刻打断我。', soul: '冷静、客观、惜字如金。只讲事实和判断，不渲染情绪，不用「重磅」这类词。', skills: ['信源扫描', '每日摘要', '破例打断判断'] },
  { re: /报销|发票|账单|订阅|扣款|记账/, name: '账单管家', glyph: '账', role: '收发票、归集报销、盯订阅续费和自动扣款。超预算提醒我。', soul: '严谨、精确、可靠。数字一分不差，对陌生扣款保持警觉，说话像会计不像销售。', skills: ['邮箱抓发票', '填报销单', '盯订阅到期'] },
  { re: /票|酒店|出差|机票|高铁|行程/, name: '行程助理', glyph: '程', role: '我提前要去哪，就订票、比方案、把单填好。付款和退改前一定问我。', soul: '干练、稳妥，像跑过很多趟的老助理。方案给得清楚，对时间和退改规则格外谨慎。', skills: ['比车次', '订酒店', '退改签'] },
  { re: /面试|简历|招聘|候选人/, name: '招聘助理', glyph: '招', role: '筛简历、约面试、跟进候选人。发给候选人的每一条消息先给我看。', soul: '专业、礼貌、有分寸。对候选人友好但不替用户承诺任何事，对用户直言候选人的短板。', skills: ['简历初筛', '约面试', '候选人跟进'] },
];

function inferBot(text: string): Omit<Bot, 'id' | 'createdAt'> {
  const existing = getState().bots.map((b) => b.name);
  const t = BOT_TEMPLATES.find((x) => x.re.test(text));
  let name = t?.name ?? `${summarize(text).replace(/[，。、]/g, '').slice(0, 4)}助手`;
  if (existing.includes(name)) {
    let i = 2;
    while (existing.includes(`${name} ${i}`)) i += 1;
    name = `${name} ${i}`;
  }
  return {
    name,
    glyph: t?.glyph ?? name.slice(0, 1),
    tagline: t ? t.role.split(/[。，]/)[0] : summarize(text),
    role: t?.role ?? `帮我${summarize(text)}。花钱和对外发消息之前先问我。`,
    soul: t?.soul ?? '像一个靠谱的同事：说话简短直接，不客套，不解释自己在做什么；有把握就给结论，没把握就说没把握。',
    channels: ['app'],
    connections: [],
    autonomy: 'prepare',
    viewOfYou: [],
    skills: t?.skills ?? [],
    routines: [],
    notify: true,
    pinned: false,
    avatarSeed: `${name}:${Date.now()}`,
  };
}

/* -------- the service -------- */

export class MockAgentService implements AgentService {
  private timers: ReturnType<typeof setTimeout>[] = [];

  onDraftMessage(text: string) {
    const bot = addBot(inferBot(text));
    const threadId = botThread(bot.id);
    select(threadId);
    showIdentity();
    addMessage({ threadId, author: 'bot', botId: bot.id, ts: Date.now(), text: `我是${bot.name}，以后负责：${bot.role} 职责、权限和记忆都在右边「Bot 身份」里，随时改。先办你这句：`, status: '由你的第一句话生成' });
    this.onUserMessage(threadId, text);
  }

  async migrateTo() {
    throw new Error('演示模式没有后端，搬不了');
  }
  async remoteInstall(): Promise<{ code: string; url: string }> {
    throw new Error('演示模式没有后端');
  }
  async startSteward(): Promise<string> {
    throw new Error('演示模式没有后端');
  }
  machineConnect() {}
  machineMove() {}

  onUserMessage(threadId: ThreadId, text: string, via?: Channel, _files?: FileRef[]) {
    const { primary, others, matterId } = botsIn(threadId);
    // In a matter group, an @mention picks the responder.
    const mentioned = others.concat(primary).find((b) => text.includes('@' + b.name));
    const bot = mentioned ?? primary;
    const t = text.replace(new RegExp(`@${bot.name}\\s*`, 'g'), '');

    const existing = openTodoFor(bot.id, matterId);
    const isClose = /算了|取消|不用了|不要了|别订|删掉|不办了/.test(t);
    const isUpdate = /改|换|变成|加上|多|少|一等|二等|早点|晚点|换成/.test(t) && !!existing;
    const isQuestion = /[?？]$|吗|呢$|怎么|多少|什么|哪/.test(t) && !/[。]$/.test(t) && !isUpdate;

    let receipt: { kind: 'created' | 'updated' | 'closed' | 'reply'; text: string; todoId?: string } | undefined;
    let todoId: string | undefined;

    if (isClose && existing) {
      patchTodo(existing.id, { status: 'done' });
      receipt = { kind: 'closed', text: `关掉了：${existing.title}`, todoId: existing.id };
      todoId = existing.id;
    } else if (isUpdate && existing) {
      patchTodo(existing.id, { status: 'doing' });
      receipt = { kind: 'updated', text: `更新了：${existing.title} · ${summarize(t)}`, todoId: existing.id };
      todoId = existing.id;
    } else if (isQuestion) {
      receipt = { kind: 'reply', text: '只是问一句，没记事项' };
    } else {
      const todo = addTodo({ botId: bot.id, matterId, title: summarize(t), status: 'open' });
      receipt = { kind: 'created', text: `记为新事项：${todo.title}`, todoId: todo.id };
      todoId = todo.id;
    }

    addMessage({ threadId, author: 'user', text, ts: Date.now(), receipt, via, mentions: mentioned ? [mentioned.id] : undefined });

    void (async () => {
      if (isClose && existing) {
        patchTodo(existing.id, { result: '你说不做了。已填的信息保留一周。' });
        await botSays(bot, threadId, `好，${existing.title}不做了。已经填的东西我留着，一周内想恢复回我一句。`, { todoId: existing.id });
        return;
      }
      if (isQuestion) {
        await botSays(bot, threadId, `${this.answer(bot, t)}`);
        return;
      }
      let handled = false;
      if (bot.id === 'trip') handled = await tripScenario(bot, threadId, t, todoId, matterId);
      else if (bot.id === 'bill') handled = await billScenario(bot, threadId, t, todoId, matterId);
      else if (bot.id === 'sentinel') handled = await sentinelScenario(bot, threadId, t, todoId);
      if (!handled) await genericScenario(bot, threadId, t, todoId, matterId);

      // Cross-bot handoff inside a matter: money words pull in the bill bot.
      if (matterId && bot.id !== 'bill' && /报|发票|付|钱|费/.test(t)) {
        const bill = others.find((b) => b.id === 'bill');
        if (bill) await botSays(bill, threadId, `@${bot.name} 这笔抄我一份，抬头用公司的。超过标准我先提醒。`, { mentions: [bot.id] }, 1800);
      }
    })();
  }

  private answer(bot: Bot, q: string) {
    const s = getState();
    const todos = s.todos.filter((t) => t.botId === bot.id && t.status !== 'done');
    if (/在做什么|进度|怎么样|到哪/.test(q)) {
      if (!todos.length) return '手上没有在做的事。你交待一句我就开始。';
      return `手上 ${todos.length} 件：${todos.map((t) => `${t.title}（${statusLabel(t.status)}）`).join('；')}。`;
    }
    if (/为什么|怎么选/.test(q)) return `我按右栏"它眼中的你"里的这几条选的：${bot.viewOfYou.slice(0, 2).join('；')}。哪条不对你直接删掉，我下次就不这么选了。`;
    return `这个我不确定，先不猜。你要的话我去查一下，查到了记进事项里。`;
  }

  submitLogin() {
    /* demo mode: nothing to type into */
  }

  submitSecrets() {
    /* mock: nothing to store */
  }
  connectChannel() {
    /* mock: no IM */
  }
  disconnectChannel() {
    /* mock: no IM */
  }
  computerPower() {
    /* mock: no computer */
  }

  onPendingChoice(pendingId: string, optionId: string) {
    const s = getState();
    const p = s.pendings.find((x) => x.id === pendingId);
    if (!p || p.resolved) return;
    const bot = s.bots.find((b) => b.id === p.botId)!;
    const opt = p.options.find((o) => o.id === optionId);
    const label = opt?.label ?? optionId;
    resolvePending(p.id, label);
    patchMessage(p.messageId, { status: `你选了：${label}` });
    addMessage({ threadId: p.threadId as ThreadId, author: 'user', text: label, ts: Date.now(), receipt: { kind: 'reply', text: `回了 ${bot.name}` } });
    void this.afterChoice(bot, p, optionId, label);
  }

  private async afterChoice(bot: Bot, p: Pending, optionId: string, label: string) {
    const threadId = p.threadId as ThreadId;
    const todoId = p.todoId ?? openTodoFor(bot.id, p.matterId)?.id;

    if (p.kind === 'blocked') {
      setState((s) => ({
        bots: s.bots.map((b) => (b.id === bot.id ? { ...b, connections: b.connections.map((c) => (c.status === 'expired' ? { ...c, status: 'ok' as const } : c)) } : b)),
      }));
      await botSays(bot, threadId, '登录态回来了，接着办。刚才停下的地方我从头核对了一遍。', { todoId });
      if (todoId) patchTodo(todoId, { status: 'waiting' });
      addAction({ botId: bot.id, matterId: p.matterId, todoId, text: '12306 重新登录，核对订单' });
      return;
    }

    if (optionId === 'pay' || (optionId === 'go' && p.amount)) {
      const isHotel = /酒店|晚/.test(p.title);
      const orderNo = 'E' + Math.floor(1000000 + Math.random() * 9000000);
      await botSays(bot, threadId, `付好了，¥${p.amount}，订单 ${orderNo}。${isHotel ? '订单已抄给账单管家，抬头用公司的。' : '电子发票已申请，24 小时内到邮箱。'}${isHotel ? '' : ' 开车前 2 小时内退改免费。'}`, { status: '已完成', todoId });
      addAction({ botId: bot.id, matterId: p.matterId, todoId, text: `付款 ¥${p.amount} · ${p.title}`, undoable: true });
      if (!isHotel) addAction({ botId: bot.id, matterId: p.matterId, todoId, text: '申请电子发票' });
      if (todoId) patchTodo(todoId, { status: 'done', result: `${p.title}，¥${p.amount}，订单 ${orderNo}。${isHotel ? '订单已抄给账单管家。' : '电子发票 24 小时内到邮箱，开车前 2 小时内退改免费。'}` });
      // Owner bot reports into the matter group, bill bot picks it up.
      if (p.matterId && threadId !== matterThread(p.matterId)) {
        const mt = matterThread(p.matterId);
        await botSays(bot, mt, `${isHotel ? '酒店' : '票'}订好了，¥${p.amount}。@账单管家 这笔要报销。`, { mentions: ['bill'] }, 1500);
        const bill = getState().bots.find((b) => b.id === 'bill');
        if (bill) await botSays(bill, mt, `收到，归进"9 月报销"，发票到了我填单。`, {}, 1600);
      }
      return;
    }
    if (optionId === 'later') {
      await botSays(bot, threadId, '好，先放着。余票或价格有变我会再叫你，其他情况不打扰。', { todoId });
      if (todoId) patchTodo(todoId, { status: 'open' });
      return;
    }
    if (optionId === 'switch') {
      const msgId = Math.random().toString(36).slice(2, 10);
      const np = addPending({
        botId: bot.id, threadId, matterId: p.matterId, todoId: p.todoId, kind: 'clarify', title: '换哪班', messageId: msgId,
        options: TRAINS.map((t) => ({ id: t.id, label: t.label.split(' · ')[1] })),
      });
      await botSays(bot, threadId, '这三班现在都有票，你点一个。', { id: msgId, status: '等你', todoId, card: { type: 'options', pendingId: np.id, options: TRAINS } });
      return;
    }
    const train = TRAINS.find((t) => t.id === optionId);
    if (train) {
      await offer(bot, threadId, {
        title: `${train.label.replace(' · ', ' · ')} 上海虹桥 → 杭州东 · 二等座`, sub: `${train.hint} · 支付宝 Agent 支付，会弹到你手机确认`, amount: 73, todoId, matterId: p.matterId,
        paidText: `${train.label} 二等座 ¥73 付好了。`, actionText: `付款 ${train.label.split(' · ')[0]} 二等座`,
      }, `好，${train.label.split(' · ')[0]}。乘客信息填好了，`);
      return;
    }
    if (optionId === 'near' || optionId === 'lake') {
      const near = optionId === 'near';
      await offer(bot, threadId, {
        title: near ? '滨江会场旁 · 全季酒店 · 9/15 一晚' : '西湖边 · 你上次住的那家 · 9/15 一晚', sub: `${near ? '¥420' : '¥488'} · 抬头用公司的 · 支付宝 Agent 支付`, amount: near ? 420 : 488, todoId, matterId: p.matterId,
        paidText: `酒店 ¥${near ? 420 : 488} 付好了，订单抄给账单管家。`, actionText: '付款 酒店一晚',
      }, `好，${near ? '会场附近' : '西湖边'}，9/15 入住一晚，`);
      return;
    }
    if (optionId === 'stop') {
      await botSays(bot, threadId, '好，9/8 到期不续，我会在扣款日前一天关掉自动续费，关掉后告诉你一句。', { todoId });
      addAction({ botId: bot.id, todoId, text: '标记：腾讯视频 9/8 不续费' });
      if (todoId) patchTodo(todoId, { status: 'doing' });
      return;
    }
    if (optionId === 'keep') {
      await botSays(bot, threadId, '好，继续续。我把它移出"没用过"名单，下次不问了。', { todoId });
      if (todoId) patchTodo(todoId, { status: 'done', result: '继续续费，已移出"没用过"名单。' });
      return;
    }
    await botSays(bot, threadId, `好，${label}。`);
  }

  /** Proactive events. In production these come from the backend's scheduler / event triggers. */
  start() {
    this.stop();
    // The demo timeline only plays once per dataset, otherwise every reload re-posts the same events.
    const FLAG = 'bot-crew:demo-ran';
    if (localStorage.getItem(FLAG)) return;
    localStorage.setItem(FLAG, '1');
    const schedule = (ms: number, fn: () => void) => this.timers.push(setTimeout(fn, ms));

    schedule(25000, async () => {
      const bot = getState().bots.find((b) => b.id === 'sentinel');
      if (!bot) return;
      await botSays(bot, botThread(bot.id),
        '插一句：竞品 B 刚放了多 bot 协作的 demo，和你今天在做的东西直接撞了。按设置我本该攒到晚上，这条我判断值得破例。其余的 20:30 再说。',
        { status: '主动 · 破例打断' }, 300);
    });

    schedule(55000, async () => {
      const s = getState();
      const bot = s.bots.find((b) => b.id === 'trip');
      if (!bot) return;
      const msgId = Math.random().toString(36).slice(2, 10);
      const todo = s.todos.find((t) => t.id === 't1' && t.status !== 'done') ?? openTodoFor(bot.id, 'hz');
      const p = addPending({
        botId: bot.id, threadId: botThread(bot.id), matterId: 'hz', todoId: todo?.id, kind: 'blocked', title: '12306 登录过期', detail: '需要你在浏览器里重新登一次', messageId: msgId,
        options: [{ id: 'relogin', label: '我登好了', primary: true }],
      });
      if (todo) patchTodo(todo.id, { status: 'blocked' });
      const bots = s.bots.map((b) => (b.id === 'trip' ? { ...b, connections: b.connections.map((c) => (c.id === 'c1' ? { ...c, status: 'expired' as const } : c)) } : b));
      setState({ bots });
      await botSays(bot, botThread(bot.id), '卡住了：12306 的登录态过期了，我查不了余票。你在浏览器里重新登一次，登好点一下我接着办。这期间我不会动任何订单。', {
        id: msgId, status: '卡住 · 等你', todoId: todo?.id, card: { type: 'blocked', pendingId: p.id, title: '12306 · 浏览器登录态过期', sub: '重新登录后我从停下的地方继续' },
      }, 300);
    });

    schedule(95000, async () => {
      const bill = getState().bots.find((b) => b.id === 'bill');
      if (!bill) return;
      await botSays(bill, matterThread('hz'), '火车票发票到邮箱了，已填进"9 月报销"单。酒店的等订完再补。周五签字前不再打扰。', { status: '默默做完 · 只记日志', todoId: 't4' }, 300);
      addAction({ botId: 'bill', matterId: 'hz', todoId: 't4', text: '火车票发票填入报销单' });
    });
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
}

export const statusLabel = (s: TodoStatus) => t(`status.${s}`);

/** Backend selection: the runtime module decides (paired server, else VITE_CREW_WS, else the in-browser mock). */
const WS_URL = wsUrl;
export const isLive = !!WS_URL;
const HTTP_BASE = httpBase;

/** Upload one attachment for a thread; the backend stores it in the bot's workspace and returns the FileRef. Mock mode keeps it in the page. */
export async function uploadFile(threadId: ThreadId, file: File): Promise<FileRef> {
  if (!HTTP_BASE) return { name: file.name, path: file.name, size: file.size, mime: file.type || 'application/octet-stream', url: URL.createObjectURL(file) };
  const r = await fetch(`${HTTP_BASE}/upload/${encodeURIComponent(threadId)}?name=${encodeURIComponent(file.name || 'file')}`, { method: 'POST', body: file, headers: { 'content-type': file.type || 'application/octet-stream', ...authHeaders() } });
  const j = (await r.json()) as FileRef & { error?: string };
  if (!r.ok) throw new Error(j.error || `上传失败（${r.status}）`);
  return j;
}
// One instance per page, surviving Vite HMR: a re-evaluated module must not create a second,
// never-started client that swallows clicks.
const g = globalThis as unknown as { __crewAgent?: AgentService };
export const agent: AgentService = g.__crewAgent ?? (g.__crewAgent = WS_URL ? new WsAgentService(WS_URL) : new MockAgentService());

// Module-level singletons (state, listeners, the WS client) cannot be hot-swapped safely: a stale
// copy would keep receiving server events while React renders from the new one. Reload instead.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
