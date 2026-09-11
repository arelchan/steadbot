import type { Action, Bot, Matter, Message, Pending, State, Todo } from '../types';
import { botThread, matterThread, DEFAULT_LAYOUT } from '../types';

const DAY = 86400000;
const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const at = (daysAgo: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return startOfToday() - daysAgo * DAY + h * 3600000 + m * 60000;
};

export const BOTS: Bot[] = [
  {
    id: 'trip',
    name: '行程助理',
    glyph: '程',
    tagline: '我提前要去哪，它就订票、比方案、把单填好，付款前一定问我',
    role: '我提前要去哪，就订票、比方案、把单填好。酒店一起管。付款和退改前一定问我。',
    soul: '干练、稳妥，像跑过很多趟的老助理。方案给得清楚，对时间和退改规则格外谨慎。',
    channels: ['feishu', 'app', 'wechat'],
    connections: [
      { id: 'c1', name: '12306 · 你的浏览器登录态', kind: 'browser', status: 'ok' },
      { id: 'c2', name: '携程 · MCP', kind: 'mcp', status: 'ok' },
      { id: 'c3', name: '飞书日历', kind: 'calendar', status: 'ok' },
      { id: 'c4', name: '支付宝 Agent 支付', kind: 'pay', status: 'ok', note: '每笔确认' },
    ],
    autonomy: 'prepare',
    viewOfYou: [
      '出差火车优先二等座，上次改过一次一等座',
      '早上不坐 7 点前的车',
      '住会场附近胜过住熟悉的地方',
      '发票抬头用公司的',
    ],
    skills: ['比车次 · 12306 / 携程', '填乘客信息下单', '退改签', '订酒店 · 按会场距离比', '申请电子发票', '写进飞书日历'],
    routines: [
      { id: 'r1', title: '出发前一天核对车票、酒店和天气', schedule: '出行前一天 18:00', enabled: true, lastRun: at(9, '18:00') },
      { id: 'r2', title: '盯已订班次的余票和价格变化', schedule: '每 2 小时', enabled: true, lastRun: at(0, '07:29') },
    ],
    notify: true,
    pinned: true,
    createdAt: at(30, '10:00'),
  },
  {
    id: 'bill',
    name: '账单管家',
    glyph: '账',
    tagline: '发票、报销、订阅续费，它归集好，超预算提醒我',
    role: '收发票、归集报销、盯订阅续费和自动扣款。超过预算或有陌生扣款提醒我。',
    soul: '严谨、精确、可靠。数字一分不差，对陌生扣款保持警觉，说话像会计不像销售。',
    channels: ['app', 'wechat'],
    connections: [
      { id: 'c5', name: '邮箱（发票）', kind: 'mail', status: 'ok' },
      { id: 'c6', name: '飞书报销', kind: 'api', status: 'ok' },
      { id: 'c7', name: '支付宝账单', kind: 'api', status: 'ok' },
    ],
    autonomy: 'prepare',
    viewOfYou: ['差旅住宿标准 ¥500/晚', '订阅超过三个月没用过会问我要不要退', '报销单周五集中签'],
    skills: ['邮箱抓发票', '填飞书报销单', '盯订阅到期', '识别陌生扣款', '月度账单汇总'],
    routines: [
      { id: 'r3', title: '订阅到期前 3 天问要不要续', schedule: '每天 09:30', enabled: true, lastRun: at(1, '09:30') },
      { id: 'r4', title: '月度账单汇总，标出陌生扣款', schedule: '每月 1 日', enabled: true, lastRun: at(5, '09:00') },
      { id: 'r5', title: '周五归集本周发票，提醒签报销单', schedule: '每周五 16:00', enabled: false },
    ],
    notify: true,
    pinned: false,
    createdAt: at(24, '10:00'),
  },
  {
    id: 'sentinel',
    name: '信息哨兵',
    glyph: '哨',
    tagline: '盯我关心的人和事，每晚 20:30 汇报，重要的立刻说',
    role: '盯我关心的公众号、群、邮件和竞品动态。每天 20:30 一份摘要，只有真正重要的才立刻打断我。',
    soul: '冷静、客观、惜字如金。只讲事实和判断，不渲染情绪，不用「重磅」这类词。',
    channels: ['telegram', 'app'],
    connections: [
      { id: 'c8', name: 'Telegram', kind: 'api', status: 'ok' },
      { id: 'c9', name: '公众号订阅（RSS）', kind: 'api', status: 'ok' },
      { id: 'c10', name: '工作邮箱', kind: 'mail', status: 'ok' },
    ],
    autonomy: 'tell',
    viewOfYou: ['关心 agent 产品和多 agent 协作', '不看融资八卦', '晚上 20:30 之后才看长内容'],
    skills: ['公众号 / RSS 扫描', 'Telegram 群监听', '邮件筛重要度', '每日摘要', '破例打断判断'],
    routines: [
      { id: 'r6', title: '扫全部信源，挑出值得看的', schedule: '每天 20:30', enabled: true, lastRun: at(1, '20:30') },
      { id: 'r7', title: '竞品发布监测', schedule: '每 30 分钟', enabled: true, lastRun: at(0, '08:00') },
    ],
    notify: true,
    pinned: false,
    createdAt: at(20, '10:00'),
  },
];

export const MATTERS: Matter[] = [
  {
    id: 'hz',
    title: '杭州出差',
    date: '9/15',
    summary: '9/15 去杭州开会，当天来回改成住一晚。票、酒店、报销一起管。',
    ownerBotId: 'trip',
    participantBotIds: ['trip', 'bill'],
    tools: ['12306', '携程 MCP', '邮箱（发票）', '飞书报销', '支付宝 Agent 支付'],
    status: 'active',
    notify: true,
    pinned: false,
    createdAt: at(4, '09:12'),
  },
];

const T = botThread('trip');
const B = botThread('bill');
const S = botThread('sentinel');
const M = matterThread('hz');

export const MESSAGES: Message[] = [
  // trip DM
  { id: 'm1', threadId: T, author: 'user', text: '下周二去杭州开会，上午到。', ts: at(4, '09:12'), via: 'feishu', receipt: { kind: 'created', text: '记为新事项：杭州出差 · 9/15', todoId: 't1' } },
  {
    id: 'm2', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(4, '09:12'),
    text: '收到。我理解为：9/15 周二上午到杭州，从上海出发，二等座优先，和之前一样。周三前我把班次比好，先不买。理解有误直接回我一句就行。',
  },
  { id: 'm3', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(2, '18:40'), text: '比了 7:15、8:00、9:00 三班，都是 ¥73，余票充足。先不买，周五再看，紧张了会先找你。', status: '查了 12306 和携程' },
  {
    id: 'm4', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(0, '07:30'),
    text: '8:00 那班余票掉了。按你的习惯我选了它，乘客信息和订单都填好了，停在付款这一步。',
    card: { type: 'confirm', pendingId: 'p1', title: 'G7317 · 08:00 上海虹桥 → 09:05 杭州东 · 二等座', sub: '余 12 张 · 支付宝 Agent 支付，会弹到你手机确认', amount: 73 },
    status: '等你',
  },
  { id: 'm5', threadId: T, author: 'user', text: '改一等座。', ts: at(0, '07:31'), receipt: { kind: 'updated', text: '更新了：杭州出差 · 座位改为一等座', todoId: 't1' } },
  {
    id: 'm6', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(0, '07:31'),
    text: '好，同一班一等座 ¥117，余 5 张，订单改好了。',
    card: { type: 'confirm', pendingId: 'p2', title: 'G7317 · 08:00 上海虹桥 → 09:05 杭州东 · 一等座', sub: '余 5 张 · 支付宝 Agent 支付，会弹到你手机确认', amount: 117 },
    status: '等你',
  },
  // bill DM
  { id: 'm7', todoId: 't2', threadId: B, author: 'bot', botId: 'bill', ts: at(1, '23:10'), text: '腾讯视频 9/8 到期，¥30/月。你最近三个月没打开过，建议不续。到期前我不会做任何事，你不回我就当默认不续。', status: '等你' },
  // sentinel DM
  {
    id: 'm8', todoId: 't5', threadId: S, author: 'bot', botId: 'sentinel', ts: at(1, '20:30'),
    text: '今天扫了 86 条，只有 3 条值得打断你：1. 机器之心报道 Anthropic 发布 Agent 身份层草案，和你在写的那篇直接相关；2. OpenClaw 新版支持定时触发和多 IM 投放，你上周问过它能不能常驻；3. 竞品 A 上线多 bot 协作 beta，和我们撞了。其余归档了，想看回我「全部」。',
  },
  // matter group
  { id: 'm9', todoId: 't1', threadId: M, author: 'bot', botId: 'trip', ts: at(0, '07:33'), text: '票买好了，G7317 一等座 ¥117，电子发票已申请，24 小时内到邮箱。@账单管家 这笔要报销。', mentions: ['bill'] },
  { id: 'm10', todoId: 't4', threadId: M, author: 'bot', botId: 'bill', ts: at(0, '07:33'), text: '收到，归进"9 月报销"。发票到了我填进飞书报销单，周五提交前找你签。', status: '两个 bot 之间的交接你都看得见' },
  { id: 'm11', threadId: M, author: 'user', text: '酒店也一起报。', ts: at(0, '09:02'), receipt: { kind: 'created', text: '新事项：杭州出差 · 酒店', todoId: 't3' } },
  { id: 'm12', todoId: 't4', threadId: M, author: 'bot', botId: 'bill', ts: at(0, '09:02'), text: '好。@行程助理 酒店发票抬头用公司的，订单抄我一份。住宿标准是 ¥500/晚，超了我先提醒。', mentions: ['trip'] },
  {
    id: 'm13', todoId: 't3', threadId: M, author: 'bot', botId: 'trip', ts: at(0, '09:03'),
    text: '酒店我还没订。会场在滨江，你要住会场附近，还是像上次一样住西湖边？两个都在标准内。',
    card: { type: 'options', pendingId: 'p3', options: [
      { id: 'near', label: '会场附近 · 步行 5 分钟', hint: '¥420/晚 · 携程', price: '¥420' },
      { id: 'lake', label: '西湖边 · 你上次住的', hint: '¥488/晚 · 打车到会场 25 分钟', price: '¥488' },
    ] },
    status: '等你',
  },
];

export const TODOS: Todo[] = [
  { id: 't1', botId: 'trip', matterId: 'hz', title: '9/15 上海→杭州 高铁票', status: 'waiting', summary: 'G7317 一等座 ¥117 订单填好，停在付款', createdAt: at(4, '09:12'), updatedAt: at(0, '07:31'), fromMessageId: 'm1' },
  { id: 't2', botId: 'bill', title: '腾讯视频续费决定（9/8）', status: 'waiting', summary: '建议不续，等你一句；不回默认不续', createdAt: at(1, '23:10'), updatedAt: at(1, '23:10') },
  { id: 't3', botId: 'trip', matterId: 'hz', title: '杭州 9/15 住一晚 酒店', status: 'waiting', summary: '比了 6 家，两个在标准内，等你选住哪边', createdAt: at(0, '09:02'), updatedAt: at(0, '09:03'), fromMessageId: 'm11' },
  { id: 't4', botId: 'bill', matterId: 'hz', title: '9 月报销单归集', status: 'doing', summary: '等火车票发票到邮箱，到了自动填单', createdAt: at(0, '07:33'), updatedAt: at(0, '07:33') },
  { id: 't5', botId: 'sentinel', title: '每日 20:30 摘要', status: 'doing', summary: '昨晚扫 86 条挑 3 条；今晚 20:30 下一份', createdAt: at(20, '10:00'), updatedAt: at(1, '20:30') },
  { id: 't0', botId: 'trip', title: '8/28 北京出差 往返高铁', status: 'done', summary: '往返都订好，¥1106，发票已归账单管家', result: 'G1 07:00 出发 / G27 返程，¥1106。发票 8/30 到邮箱，已进 8 月报销。', createdAt: at(12, '10:00'), updatedAt: at(9, '18:00') },
];

export const PENDINGS: Pending[] = [
  { id: 'p1', botId: 'trip', threadId: T, matterId: 'hz', todoId: 't1', kind: 'confirm', title: 'G7317 二等座付款', amount: 73, options: [], messageId: 'm4', createdAt: at(0, '07:30'), resolved: { at: at(0, '07:31'), choice: '改一等座' } },
  {
    id: 'p2', botId: 'trip', threadId: T, matterId: 'hz', todoId: 't1', kind: 'confirm', title: 'G7317 一等座付款', detail: '08:00 上海虹桥 → 09:05 杭州东', amount: 117, messageId: 'm6', createdAt: at(0, '07:31'),
    options: [
      { id: 'pay', label: '确认付款', primary: true },
      { id: 'switch', label: '换班次' },
      { id: 'later', label: '先放着' },
    ],
  },
  {
    id: 'p3', botId: 'trip', threadId: M, matterId: 'hz', todoId: 't3', kind: 'clarify', title: '酒店住哪边', detail: '会场附近 ¥420 / 西湖边 ¥488', messageId: 'm13', createdAt: at(0, '09:03'),
    options: [
      { id: 'near', label: '会场附近', primary: true },
      { id: 'lake', label: '西湖边' },
    ],
  },
  {
    id: 'p4', botId: 'bill', threadId: B, todoId: 't2', kind: 'clarify', title: '腾讯视频 9/8 续费', detail: '¥30/月，三个月没用过', messageId: 'm7', createdAt: at(1, '23:10'),
    options: [
      { id: 'stop', label: '不续', primary: true },
      { id: 'keep', label: '续' },
    ],
  },
];

export const ACTIONS: Action[] = [
  { id: 'a1', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(2, '18:40'), text: '比了 3 班车，写进对话' },
  { id: 'a2', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:29'), text: '查 12306 余票（第 6 次）' },
  { id: 'a3', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:30'), text: '填好 G7317 订单，停在付款' },
  { id: 'a4', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:31'), text: '改订单为一等座' },
  { id: 'a5', todoId: 't4', botId: 'bill', matterId: 'hz', ts: at(0, '07:33'), text: '新建"9 月报销"归集' },
  { id: 'a6', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:33'), text: '申请电子发票' },
  { id: 'a7', todoId: 't3', botId: 'trip', matterId: 'hz', ts: at(0, '09:03'), text: '在携程比了 6 家酒店' },
  { id: 'a8', todoId: 't5', botId: 'sentinel', ts: at(1, '20:30'), text: '扫 86 条，挑出 3 条，其余归档', undoable: true },
];

export const SHARED_PROFILE = [
  '在上海，常去杭州、北京出差',
  '公司报销：住宿 ¥500/晚，火车二等座（可自付升级）',
  '工作日 9:30 之后再打扰，20:30 之后看长内容',
  '偏好少而准的汇报：做了什么、停在哪、为什么',
];

export const seedState = (): State => ({
  bots: BOTS,
  matters: MATTERS,
  todos: TODOS,
  events: [],
  pendings: PENDINGS,
  actions: ACTIONS,
  messages: MESSAGES,
  skills: [],
  library: [],
  integrations: [],
  sharedProfile: SHARED_PROFILE,
  selection: 'week',
  toasts: [],
  typing: {},
  lastSeen: { 'bot:trip': Date.now(), 'matter:hz': Date.now() },
  panel: { mode: 'board' },
  panels: { identity: true, tasks: true },
  layout: { ...DEFAULT_LAYOUT },
  focusMessageId: undefined,
});
