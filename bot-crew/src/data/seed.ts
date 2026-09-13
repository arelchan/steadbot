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
    name: 'Travel',
    glyph: 'T',
    tagline: 'Tell it where I need to be; it books, compares and fills in the forms, and always asks before paying',
    role: 'When I need to be somewhere, book it: compare options, fill in the details, handle the hotel too. Always ask before paying or changing a booking.',
    soul: 'Brisk and dependable, like an assistant who has run this trip fifty times. Options laid out plainly; careful about times and change fees.',
    channels: ['slack', 'app', 'telegram'],
    connections: [
      { id: 'c1', name: 'Amtrak · your browser session', kind: 'browser', status: 'ok' },
      { id: 'c2', name: 'Expedia · MCP', kind: 'mcp', status: 'ok' },
      { id: 'c3', name: 'Google Calendar', kind: 'calendar', status: 'ok' },
      { id: 'c4', name: 'Card on file', kind: 'pay', status: 'ok', note: 'confirm every charge' },
    ],
    autonomy: 'prepare',
    viewOfYou: [
      'Coach by default; upgraded to business once, last trip',
      'Nothing departing before 7am',
      'Near the venue beats near anything familiar',
      'Invoices go to the company name',
    ],
    skills: ['Compare trains · Amtrak / Expedia', 'Fill passenger details and hold', 'Changes and refunds', 'Hotels · ranked by walk to venue', 'Request an invoice', 'Write it into the calendar'],
    routines: [
      { id: 'r1', title: 'Check tickets, hotel and weather the day before', schedule: 'day before departure, 18:00', enabled: true, lastRun: at(9, '18:00') },
      { id: 'r2', title: 'Watch seats and prices on booked trains', schedule: 'every 2 hours', enabled: true, lastRun: at(0, '07:29') },
    ],
    notify: true,
    pinned: true,
    createdAt: at(30, '10:00'),
  },
  {
    id: 'bill',
    name: 'Expenses',
    glyph: 'E',
    tagline: 'Invoices, expense reports, subscription renewals — it keeps them straight and flags anything over budget',
    role: 'Collect invoices, file expense reports, watch subscriptions and automatic charges. Tell me when something goes over budget or looks unfamiliar.',
    soul: 'Precise and unhurried. The numbers are exact, unfamiliar charges get a second look, and it talks like a bookkeeper rather than a salesperson.',
    channels: ['app', 'slack'],
    connections: [
      { id: 'c5', name: 'Mailbox (invoices)', kind: 'mail', status: 'ok' },
      { id: 'c6', name: 'Expensify', kind: 'api', status: 'ok' },
      { id: 'c7', name: 'Card statements', kind: 'api', status: 'ok' },
    ],
    autonomy: 'prepare',
    viewOfYou: ['Hotel cap is $180/night', 'Ask before renewing anything unused for three months', 'Expense reports get signed on Fridays'],
    skills: ['Pull invoices from mail', 'File an expense report', 'Watch renewal dates', 'Spot unfamiliar charges', 'Monthly statement summary'],
    routines: [
      { id: 'r3', title: 'Ask about renewals three days out', schedule: 'daily 09:30', enabled: true, lastRun: at(1, '09:30') },
      { id: 'r4', title: 'Monthly statement, unfamiliar charges marked', schedule: 'monthly on the 1st', enabled: true, lastRun: at(5, '09:00') },
      { id: 'r5', title: "Friday: collect the week's invoices, prompt for signature", schedule: 'Fridays 16:00', enabled: false },
    ],
    notify: true,
    pinned: false,
    createdAt: at(24, '10:00'),
  },
  {
    id: 'sentinel',
    name: 'Watch',
    glyph: 'W',
    tagline: 'Follows the people and topics I care about, reports at 20:30, interrupts only when it matters',
    role: 'Follow the newsletters, groups, mail and competitors I care about. One digest at 20:30; interrupt me during the day only for something that genuinely cannot wait.',
    soul: 'Calm, factual, short. States what happened and what it thinks, without adjectives like "huge" or "breaking".',
    channels: ['telegram', 'app'],
    connections: [
      { id: 'c8', name: 'Telegram', kind: 'api', status: 'ok' },
      { id: 'c9', name: 'Newsletters (RSS)', kind: 'api', status: 'ok' },
      { id: 'c10', name: 'Work mailbox', kind: 'mail', status: 'ok' },
    ],
    autonomy: 'tell',
    viewOfYou: ['Cares about agent products and multi-agent work', 'Skips funding gossip', 'Reads anything long after 20:30'],
    skills: ['Scan newsletters and RSS', 'Watch Telegram groups', 'Rank mail by importance', 'Daily digest', 'Decide what is worth interrupting for'],
    routines: [
      { id: 'r6', title: 'Scan every source, keep what is worth reading', schedule: 'daily 20:30', enabled: true, lastRun: at(1, '20:30') },
      { id: 'r7', title: 'Competitor release watch', schedule: 'every 30 minutes', enabled: true, lastRun: at(0, '08:00') },
    ],
    notify: true,
    pinned: false,
    createdAt: at(20, '10:00'),
  },
];

export const MATTERS: Matter[] = [
  {
    id: 'hz',
    title: 'Seattle trip',
    date: '9/15',
    summary: 'Conference in Seattle on 9/15. Day trip turned into one night. Tickets, hotel and expenses together.',
    ownerBotId: 'trip',
    participantBotIds: ['trip', 'bill'],
    tools: ['Amtrak', 'Expedia MCP', 'Mailbox (invoices)', 'Expensify', 'Card on file'],
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
  { id: 'm1', threadId: T, author: 'user', text: 'Conference in Seattle next Tuesday, I need to be there in the morning.', ts: at(4, '09:12'), via: 'slack', receipt: { kind: 'created', text: 'Filed as a new matter: Seattle trip · 9/15', todoId: 't1' } },
  {
    id: 'm2', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(4, '09:12'),
    text: 'Got it. Reading that as: arrive in Seattle the morning of Tue 9/15, leaving from Portland, coach unless you say otherwise. I will have the options compared by Wednesday and will not buy anything yet. One line back if I have it wrong.',
  },
  { id: 'm3', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(2, '18:40'), text: 'Three departures work: 7:15, 8:00 and 9:00, all $73, plenty of seats. Not buying yet — I will look again Friday, and come find you sooner if they start filling up.', status: 'checked Amtrak and Expedia' },
  {
    id: 'm4', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(0, '07:30'),
    text: 'Seats on the 8:00 dropped. Going by what you usually pick I took that one — details filled in, order sitting at the payment step.',
    card: { type: 'confirm', pendingId: 'p1', title: 'Cascades 502 · 08:00 Portland → 09:05 Seattle · coach', sub: '12 seats left · card on file, you confirm on your phone', amount: 73, currency: 'USD' },
    status: 'waiting on you',
  },
  { id: 'm5', threadId: T, author: 'user', text: 'Make it business class.', ts: at(0, '07:31'), receipt: { kind: 'updated', text: 'Updated: Seattle trip · business class', todoId: 't1' } },
  {
    id: 'm6', todoId: 't1', threadId: T, author: 'bot', botId: 'trip', ts: at(0, '07:31'),
    text: 'Done — same train, business class $117, 5 left, order updated.',
    card: { type: 'confirm', pendingId: 'p2', title: 'Cascades 502 · 08:00 Portland → 09:05 Seattle · business', sub: '5 seats left · card on file, you confirm on your phone', amount: 117, currency: 'USD' },
    status: 'waiting on you',
  },
  // bill DM
  { id: 'm7', todoId: 't2', threadId: B, author: 'bot', botId: 'bill', ts: at(1, '23:10'), text: 'Netflix renews 9/8, $30/month. You have not opened it in three months, so I would drop it. I will do nothing until then; no answer means it lapses.', status: 'waiting on you' },
  // sentinel DM
  {
    id: 'm8', todoId: 't5', threadId: S, author: 'bot', botId: 'sentinel', ts: at(1, '20:30'),
    text: 'Scanned 86 things today; three are worth your attention. 1. Anthropic published a draft of an agent identity layer — directly relevant to the piece you are writing. 2. OpenClaw shipped scheduled triggers and multi-IM delivery; you asked last week whether it could stay resident. 3. Competitor A opened a multi-agent beta, which overlaps with us. The rest is filed — say "all" if you want it.',
  },
  // matter group
  { id: 'm9', todoId: 't1', threadId: M, author: 'bot', botId: 'trip', ts: at(0, '07:33'), text: 'Ticket bought — Cascades 502, business, $117. Invoice requested, arrives by mail within 24 hours. @Expenses this one is reimbursable.', mentions: ['bill'] },
  { id: 'm10', todoId: 't4', threadId: M, author: 'bot', botId: 'bill', ts: at(0, '07:33'), text: 'Got it, filing under "September expenses". When the invoice lands I will put it on the report and come find you to sign before Friday.', status: 'handoffs between bots stay visible to you' },
  { id: 'm11', threadId: M, author: 'user', text: 'Put the hotel on it too.', ts: at(0, '09:02'), receipt: { kind: 'created', text: 'New matter: Seattle trip · hotel', todoId: 't3' } },
  { id: 'm12', todoId: 't4', threadId: M, author: 'bot', botId: 'bill', ts: at(0, '09:02'), text: 'Will do. @Travel put the company name on the hotel invoice and copy me the booking. Cap is $180/night — I will speak up before it goes over.', mentions: ['trip'] },
  {
    id: 'm13', todoId: 't3', threadId: M, author: 'bot', botId: 'trip', ts: at(0, '09:03'),
    text: 'Hotel is not booked yet. The venue is in South Lake Union. Near the venue, or downtown where you stayed last time? Both are within the cap.',
    card: { type: 'options', pendingId: 'p3', options: [
      { id: 'near', label: 'By the venue · 5 minute walk', hint: '$142/night · Expedia', price: '$142' },
      { id: 'lake', label: 'Downtown · where you stayed last time', hint: '$168/night · 25 minutes to the venue', price: '$168' },
    ] },
    status: 'waiting on you',
  },
];

export const TODOS: Todo[] = [
  { id: 't1', botId: 'trip', matterId: 'hz', title: '9/15 Portland → Seattle train', status: 'waiting', summary: 'Cascades 502 business $117, order filled in, stopped at payment', createdAt: at(4, '09:12'), updatedAt: at(0, '07:31'), fromMessageId: 'm1' },
  { id: 't2', botId: 'bill', title: 'Netflix renewal decision (9/8)', status: 'waiting', summary: 'Recommend dropping it; no answer means it lapses', createdAt: at(1, '23:10'), updatedAt: at(1, '23:10') },
  { id: 't3', botId: 'trip', matterId: 'hz', title: 'Hotel, one night in Seattle 9/15', status: 'waiting', summary: 'Compared six, two within the cap, waiting on which side of town', createdAt: at(0, '09:02'), updatedAt: at(0, '09:03'), fromMessageId: 'm11' },
  { id: 't4', botId: 'bill', matterId: 'hz', title: 'September expense report', status: 'doing', summary: 'Waiting for the train invoice; files itself when it arrives', createdAt: at(0, '07:33'), updatedAt: at(0, '07:33') },
  { id: 't5', botId: 'sentinel', title: 'Daily 20:30 digest', status: 'doing', summary: 'Last night: 86 scanned, 3 kept. Next one at 20:30', createdAt: at(20, '10:00'), updatedAt: at(1, '20:30') },
  { id: 't0', botId: 'trip', title: '8/28 Denver trip, both legs', status: 'done', summary: 'Both legs booked, $1106, invoice handed to Expenses', result: 'Out 07:00, back on the evening train, $1106. Invoice arrived 8/30 and went onto the August report.', createdAt: at(12, '10:00'), updatedAt: at(9, '18:00') },
];

export const PENDINGS: Pending[] = [
  { id: 'p1', botId: 'trip', threadId: T, matterId: 'hz', todoId: 't1', kind: 'confirm', title: 'Pay for Cascades 502, coach', amount: 73, currency: 'USD', options: [], messageId: 'm4', createdAt: at(0, '07:30'), resolved: { at: at(0, '07:31'), choice: 'switched to business' } },
  {
    id: 'p2', botId: 'trip', threadId: T, matterId: 'hz', todoId: 't1', kind: 'confirm', title: 'Pay for Cascades 502, business', detail: '08:00 Portland → 09:05 Seattle', amount: 117, currency: 'USD', messageId: 'm6', createdAt: at(0, '07:31'),
    options: [
      { id: 'pay', label: 'Pay', primary: true },
      { id: 'switch', label: 'Different train' },
      { id: 'later', label: 'Leave it' },
    ],
  },
  {
    id: 'p3', botId: 'trip', threadId: M, matterId: 'hz', todoId: 't3', kind: 'clarify', title: 'Which side of town', detail: 'By the venue $142 / downtown $168', messageId: 'm13', createdAt: at(0, '09:03'),
    options: [
      { id: 'near', label: 'By the venue', primary: true },
      { id: 'lake', label: 'Downtown' },
    ],
  },
  {
    id: 'p4', botId: 'bill', threadId: B, todoId: 't2', kind: 'clarify', title: 'Netflix renews 9/8', detail: '$30/month, unused for three months', messageId: 'm7', createdAt: at(1, '23:10'),
    options: [
      { id: 'stop', label: 'Drop it', primary: true },
      { id: 'keep', label: 'Keep it' },
    ],
  },
];

export const ACTIONS: Action[] = [
  { id: 'a1', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(2, '18:40'), text: 'Compared three departures, wrote them up' },
  { id: 'a2', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:29'), text: 'Checked seat availability (6th time)' },
  { id: 'a3', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:30'), text: 'Filled in the order, stopped at payment' },
  { id: 'a4', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:31'), text: 'Changed the order to business class' },
  { id: 'a5', todoId: 't4', botId: 'bill', matterId: 'hz', ts: at(0, '07:33'), text: 'Opened "September expenses"' },
  { id: 'a6', todoId: 't1', botId: 'trip', matterId: 'hz', ts: at(0, '07:33'), text: 'Requested the invoice' },
  { id: 'a7', todoId: 't3', botId: 'trip', matterId: 'hz', ts: at(0, '09:03'), text: 'Compared six hotels on Expedia' },
  { id: 'a8', todoId: 't5', botId: 'sentinel', ts: at(1, '20:30'), text: 'Scanned 86, kept 3, filed the rest', undoable: true },
];

export const SHARED_PROFILE = [
  'Based in Portland; travels to Seattle and Denver often',
  'Company policy: hotels $180/night, coach rail (upgrades out of pocket)',
  'Weekdays: nothing before 9:30; long reads after 20:30',
  'Prefers short, exact reports: what was done, where it stopped, why',
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
