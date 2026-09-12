import { noteUsage } from './meter.ts';
import type { Api, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import type { Bot } from './types.ts';
import { summarize } from './util.ts';

export type NewBot = Omit<Bot, 'id' | 'createdAt'>;

/** One character, counted the way a reader counts them: an emoji is one, and half of one is 「�」. */
const firstChar = (s: string) => [...s][0] ?? '';

function uniqueName(name: string, existing: string[]) {
  if (!existing.includes(name)) return name;
  let i = 2;
  while (existing.includes(`${name} ${i}`)) i += 1;
  return `${name} ${i}`;
}

/**
 * The record a bot is created into, before anything about it is known. Deliberately says nothing: the UI draws a
 * skeleton for name, tagline and avatar while `generating.identity` is on, so guessing here only flashes the wrong
 * identity for two seconds — which is what the keyword table this replaced did on every other brief.
 */
export function blankBot(brief: string, existing: string[]): NewBot {
  const name = uniqueName(`${summarize(brief).replace(/[，。、]/g, '').slice(0, 4)}助手`, existing);
  return {
    name,
    glyph: name.slice(0, 1),
    tagline: summarize(brief),
    role: `帮我${summarize(brief)}。花钱和对外发消息之前先问我。`,
    soul: '像一个靠谱的同事：说话简短直接，不客套，不解释自己在做什么；有把握就给结论，没把握就说没把握。',
    channels: ['app'],
    connections: [],
    autonomy: 'prepare',
    viewOfYou: [],
    skills: [],
    routines: [],
    notify: true,
    pinned: false,
    avatarSeed: `${name}:${Date.now()}`,
  };
}

/** 用哪种语言写它的名字和人设：跟界面语言走，auto 就跟用户这句话走。 */

/**
 * 这句话是用什么写的。「跟着用户的语言」这条指令在一段中文提示词里是压不住的——模型跟着提示词走，
 * 英文的需求照样生出中文人设——所以这里先替它判断，再把结论写进提示词。
 */
function scriptOf(text: string): string {
  if (/[\u3040-\u30ff]/.test(text)) return '日文';
  if (/[\uac00-\ud7af]/.test(text)) return '韩文';
  if (/[\u0400-\u04ff]/.test(text)) return '俄文';
  if (/[\u4e00-\u9fff]/.test(text)) return '简体中文';
  return '英文';
}

/** 出生时它能知道的一切：团队里已经有谁、用户是个什么人、这台机器已经连了什么、说什么语言。 */
export interface Birthplace {
  /** 记在谁头上 */
  botId?: string;
  existing: { name: string; tagline: string }[];
  profile?: string[];
  integrations?: string[];
}

/**
 * The bot's identity, written rather than filled in.
 *
 * What makes two bots born from similar sentences come out different is not the model — it is what the model is
 * told: who is already on this team (so the new one does not overlap), what the user is like, what this machine can
 * actually reach. So the prompt hands over the situation and a list of things not to write, and leaves the shape of
 * the answer — how long the role runs, what the persona is about — to the model. The old prompt specified the shape
 * ("2-4 个汉字", "1-2 句", "3 个能力短语") and got the same bot back every time.
 */
export async function inferBot(text: string, place: Birthplace, runtime?: ModelRuntime, model?: Model<Api>): Promise<NewBot & { hints: string[] }> {
  const names = place.existing.map((b) => b.name);
  const fallback = { ...blankBot(text, names), hints: [] as string[] };
  if (!runtime || !model || model.provider === 'faux') return fallback;
  const lang = `name、tagline、role、soul 全部用${scriptOf(text)}写`;
  const team = place.existing.length ? place.existing.map((b) => `- ${b.name}：${b.tagline}`).join('\n') : '（还没有别人，它是第一个）';
  const about = place.profile?.length ? place.profile.slice(0, 6).map((l) => `- ${l}`).join('\n') : '（还不了解）';
  const reach = place.integrations?.length ? place.integrations.join('、') : '（暂时什么外部系统都没接）';
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt:
        '用户要创建一个长期为自己服务的 bot。下面是它以后长期管的那一摊活，和它出生的处境。为它写一个身份。\n' +
        '输出严格 JSON：{"name":"名字","glyph":"1 个字","tagline":"一句话简介","role":"职责与工作方式","soul":"人设","hints":["检索关键词"]}。只输出 JSON。\n\n' +
        '怎么写：\n' +

        '- name 要有实际语义：一眼看出它管哪一摊。比这次这件活宽一档，不是宽到底——用户要给自己做个人作品集网站，叫「个人作品集设计」正好；叫「小集」这种没信息量的昵称不行，叫「设计助手」「帮手」这种宽到什么都能装的也不行，把几个词各取一个字拼成生造词（「工图」）更不行。不要和团队里已有的重名，也不要是同一个词换个说法。\n' +
        '- role 一两句话，用用户对它说话的口气写（「帮我…」「…之前先问我」）：第一句说它以后长期帮我做什么——范围和名字一样宽，名字管一摊，职责就写这一摊，不要放大成「各种需要动手的活」——第二句说什么时候必须回来问我——边界要具体到一个动作（「改别人的会之前问我」），不是「重要操作前确认」。只写这两件事：不要列步骤、不要写交付物和格式、不要定没人要求过的时间点和字数，也不要出现这次活里的专有名词（哪个品类、哪家公司、哪个地方）——它以后接的活不会都关于这一件。\n' +
        '- soul 是它的性格、说话方式、待人方式，要能想象出它说话的样子。它可以有脾气、有偏好、有不爱做的事。\n' +
        '- hints 是 3-6 个检索关键词，用来去技能库里找它用得上的手册：写这份工作实际会做的事（「代码评审」「竞品监控」「会议纪要」），中英文都行，不要写「高效」这种。\n\n' +
        '不要写的：不要「专业、高效、贴心、认真负责、热情」这类谁都能安上的词；不要把给你的那句话抄一遍、或拆成条款当职责；不要写这台机器做不到的事；不要和团队里已有的 bot 职责重叠——真撞上就把它写窄，写成已有的人不管的那部分。\n' +
        `${lang}。\n\n` +
        `团队里已经有的 bot：\n${team}\n\n关于用户（已知的）：\n${about}\n\n这台机器已经接入：${reach}`,
      messages: [
        {
          role: 'user',
          // The sentence is a task, not a job description, and saying so beside it beats saying it once at the top:
          // told only in the rules above, the light model writes「交付两个文件：HTML 和 PPTX」into the standing role
          // about half the time — it is the most concrete thing in front of it.
          content: `他对它说的第一句话：「${text.replace(/\s+/g, ' ').slice(0, 400)}」\n\n（这是它接到的第一件活，不是它的工作说明书。里面的主题、配色、格式、文件、页数、时间都是这一次的要求，一个都不要写进身份；也不要凭空添没人要求过的规矩。）`,
          timestamp: Date.now(),
        },
      ],
    }, { maxTokens: 1500 });
    noteUsage('birth', place.botId, res);
    const raw = res.content.map((c) => (c.type === 'text' ? c.text : '')).join('').replace(/```(?:json)?/g, '');
    const json = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as Partial<NewBot> & { hints?: unknown };
    if (!json.name || !json.role) return fallback;
    const name = uniqueName(String(json.name).trim().slice(0, 12), names);
    return {
      ...fallback,
      name,
      glyph: firstChar(String(json.glyph ?? '').trim()) || firstChar(name),
      tagline: json.tagline?.trim() || fallback.tagline,
      role: json.role.trim(),
      soul: typeof json.soul === 'string' && json.soul.trim() ? json.soul.trim() : fallback.soul,
      avatarSeed: `${name}:${Date.now()}`,
      hints: (Array.isArray(json.hints) ? json.hints : []).filter((x): x is string => typeof x === 'string').slice(0, 6),
    };
  } catch (e) {
    console.warn('[crew] inferBot fell back to a blank identity:', (e as Error).message);
    return fallback;
  }
}

/** One-off: write a persona for a bot that predates the soul field. Empty string on failure (stays editable). */
export async function inferSoul(bot: { id?: string; name: string; role: string }, runtime?: ModelRuntime, model?: Model<Api>): Promise<string> {
  if (!runtime || !model || model.provider === 'faux') return '';
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt: '为一个长期服务用户的 bot 写人设：性格、说话风格、待人方式，2 句以内，中文，要贴合它的名字和职责，不要泛泛的「专业热情」。只输出这两句，不加引号、不加标题。',
      messages: [{ role: 'user', content: `名字：${bot.name}\n职责：${bot.role}`, timestamp: Date.now() }],
    });
    noteUsage('birth', bot.id, res);
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
export async function inferSkillDocs(bot: { id?: string; name: string; role: string }, names: string[], runtime?: ModelRuntime, model?: Model<Api>): Promise<SkillDocInput[]> {
  const fallback = names.map((n) => templateSkill(n, bot));
  if (!runtime || !model || model.provider === 'faux' || !names.length) return fallback;
  try {
    const res = await runtime.completeSimple(model, {
      systemPrompt:
        '你在为一个长期服务用户的 bot 编写「技能」文档。每个技能是一份可复用的操作手册（Markdown），bot 执行相关任务时会读取它。输出严格 JSON 数组，每项：{"name":"技能名（必须与输入完全一致）","description":"一句话，<=60 字，说明这个技能做什么、什么时候用","body":"Markdown 正文：## 目的 / ## 何时使用 / ## 步骤（编号，具体到可执行） / ## 需要用户确认的点 / ## 注意事项。300-600 字，中文，不要标题以外的一级标题。"}。只输出 JSON。',
      messages: [{ role: 'user', content: `bot 名字：${bot.name}\nbot 职责：${bot.role}\n技能列表：${names.join('、')}`, timestamp: Date.now() }],
    }, { maxTokens: 8000 });
    noteUsage('build', bot.id, res);
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
