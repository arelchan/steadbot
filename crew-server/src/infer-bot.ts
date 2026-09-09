import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Bot } from './types.ts';
import { summarize } from './util.ts';

export type NewBot = Omit<Bot, 'id' | 'createdAt'>;

const TEMPLATES: { re: RegExp; name: string; glyph: string; role: string; soul: string; skills: string[] }[] = [
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

function uniqueName(name: string, existing: string[]) {
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${name} ${i}`)) i += 1;
  return `${name} ${i}`;
}

export function fromTemplate(text: string, existing: string[]): NewBot {
  const t = TEMPLATES.find((x) => x.re.test(text));
  const name = uniqueName(t?.name ?? `${summarize(text).replace(/[，。、]/g, '').slice(0, 4)}助手`, existing);
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

/**
 * Turn the user's first sentence into a bot identity. With a model: one cheap JSON completion.
 * Without (or on any failure): keyword templates, so the product never stalls on this step.
 */
export async function inferBot(text: string, existing: string[], runtime?: ModelRuntime, model?: Model<Api>): Promise<NewBot> {
  const fallback = fromTemplate(text, existing);
  if (!runtime || !model || model.provider === 'faux') return fallback;
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt:
        '用户要创建一个长期为自己服务的 bot，下面是用户对它说的第一句话。请为这个 bot 起名并写职责，输出严格 JSON：{"name":"2-4 个汉字的角色名，如 行程助理","glyph":"1 个汉字","tagline":"一句话（<=18 字）","role":"以「我」为用户视角写的职责与工作流程，1-2 句，包含一条边界（什么之前要问用户）","soul":"人设：性格、说话风格、待人方式，2 句以内，要贴合这个角色，不要泛泛的「专业热情」","skills":["3 个能力短语"]}。只输出 JSON。',
      messages: [{ role: 'user', content: text, timestamp: Date.now() }],
    });
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<NewBot>;
    if (!json.name || !json.role) return fallback;
    const name = uniqueName(String(json.name).slice(0, 8), existing);
    return { ...fallback, name, glyph: (json.glyph ?? name[0]).slice(0, 1), tagline: json.tagline ?? fallback.tagline, role: json.role, soul: typeof json.soul === 'string' && json.soul.trim() ? json.soul : fallback.soul, skills: Array.isArray(json.skills) ? json.skills.slice(0, 5).map(String) : fallback.skills, avatarSeed: `${name}:${Date.now()}` };
  } catch (e) {
    console.warn('[crew] inferBot fell back to templates:', (e as Error).message);
    return fallback;
  }
}

/** One-off: write a persona for a bot that predates the soul field. Empty string on failure (stays editable). */
export async function inferSoul(bot: { name: string; role: string }, runtime?: ModelRuntime, model?: Model<Api>): Promise<string> {
  if (!runtime || !model || model.provider === 'faux') return '';
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt: '为一个长期服务用户的 bot 写人设：性格、说话风格、待人方式，2 句以内，中文，要贴合它的名字和职责，不要泛泛的「专业热情」。只输出这两句，不加引号、不加标题。',
      messages: [{ role: 'user', content: `名字：${bot.name}\n职责：${bot.role}`, timestamp: Date.now() }],
    });
    return res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim().slice(0, 200);
  } catch (e) {
    console.warn('[crew] inferSoul failed:', (e as Error).message);
    return '';
  }
}

export interface SkillDocInput {
  name: string;
  description: string;
  body: string;
}

function templateSkill(name: string, bot: { name: string; role: string }): SkillDocInput {
  return {
    name,
    description: `${bot.name}用来「${name}」时的操作手册。`,
    body: `# ${name}\n\n## 目的\n${bot.name}负责：${bot.role.split(/[。，]/)[0]}。这份手册说明如何完成「${name}」。\n\n## 何时使用\n用户提到与「${name}」相关的需求时。\n\n## 步骤\n1. 先用 todo 记下事项。\n2. 收集必要信息，缺什么用 ask_user 问一次。\n3. 执行；涉及花钱或对外发消息时通过 act，按自主度确认。\n4. 关闭事项并用一句话汇报结果。\n\n## 注意\n- 不确定的地方问用户，不要猜。\n- 结果里写清做了什么、花了多少。`,
  };
}

/**
 * Write SKILL.md contents for a bot's skills in one cheap completion. Falls back to a generic
 * template per skill so the bot always has something to load.
 */
export async function inferSkillDocs(bot: { name: string; role: string }, names: string[], runtime?: ModelRuntime, model?: Model<Api>): Promise<SkillDocInput[]> {
  const fallback = names.map((n) => templateSkill(n, bot));
  if (!runtime || !model || model.provider === 'faux' || !names.length) return fallback;
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt:
        '你在为一个长期服务用户的 bot 编写「技能」文档。每个技能是一份可复用的操作手册（Markdown），bot 执行相关任务时会读取它。输出严格 JSON 数组，每项：{"name":"技能名（必须与输入完全一致）","description":"一句话，<=60 字，说明这个技能做什么、什么时候用","body":"Markdown 正文：## 目的 / ## 何时使用 / ## 步骤（编号，具体到可执行） / ## 需要用户确认的点 / ## 注意事项。300-600 字，中文，不要标题以外的一级标题。"}。只输出 JSON。',
      messages: [{ role: 'user', content: `bot 名字：${bot.name}\nbot 职责：${bot.role}\n技能列表：${names.join('、')}`, timestamp: Date.now() }],
    }, { maxTokens: 8000 });
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start < 0 || end < 0) throw new Error(`no JSON array in response (stop=${res.stopReason}, len=${raw.length}): ${raw.slice(0, 120)}`);
    const arr = JSON.parse(raw.slice(start, end + 1)) as Partial<SkillDocInput>[];
    return names.map((n, i) => {
      const hit = arr.find((x) => x.name === n) ?? arr[i];
      return hit?.body ? { name: n, description: String(hit.description ?? ''), body: String(hit.body) } : fallback[i];
    });
  } catch (e) {
    console.warn('[crew] inferSkillDocs fell back to templates:', (e as Error).message);
    return fallback;
  }
}
