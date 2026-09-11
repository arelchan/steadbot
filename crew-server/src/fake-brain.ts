import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type AssistantMessage,
  type Context,
  type FauxProviderHandle,
  type Message,
} from '@earendil-works/pi-ai';
import type { CrewStore } from './store.ts';
import { summarize, textOf } from './util.ts';

/**
 * A scripted stand-in for the LLM so the whole product loop (message -> todo -> ask -> act -> reply,
 * handoffs, routines) runs end-to-end without model keys. It reads the conversation like a model
 * would and answers with tool calls or text. Replace with real keys in config.json to go live.
 */
export class FakeBrain {
  handle: FauxProviderHandle;
  constructor(private store: CrewStore) {
    // CREW_FAKE_TPS slows the stream down (tests that cut a reply short need time to do so).
    const tps = process.env.CREW_FAKE_TPS;
    this.handle = fauxProvider({ tokensPerSecond: Number(tps ?? 400), ...(tps ? { tokenSize: { min: 1, max: 1 } } : {}) });
    const step = (ctx: Context) => {
      this.handle.appendResponses([step]);
      return this.respond(ctx);
    };
    this.handle.setResponses([step]);
  }

  get model() {
    return this.handle.getModel();
  }

  private respond(ctx: Context): AssistantMessage {
    const msgs = ctx.messages;
    const botName = /# 你是「(.+?)」/.exec(ctx.systemPrompt ?? '')?.[1] ?? '';
    const bot = this.store.data.bots.find((b) => b.name === botName);
    // Find the latest real user message (group-transcript syncs ride along as user messages) and
    // the tool results produced since then.
    let start = msgs.length - 1;
    while (start >= 0 && !(msgs[start].role === 'user' && !/^【群聊记录】/.test(textOf(msgs[start].content)))) start--;
    const userMsg = msgs[start];
    const after = msgs.slice(start + 1);
    const toolResults = after.filter((m) => m.role === 'toolResult');
    const text = userMsg ? textOf(userMsg.content) : '';
    const fromBot = /^【来自 @?(.+?)】/.exec(text);
    const routine = /^【例行任务】/.test(text);
    const system = /^【系统】/.test(text);
    const lateChoice = /^关于「(.+?)」，我选了：(.+)$/.exec(text);

    if (!userMsg || /^【群聊记录】/.test(text)) return fauxAssistantMessage('（已同步）', { stopReason: 'stop' });
    if (system) return fauxAssistantMessage(/撤销/.test(text) ? '收到，这笔已经撤销了。要重新办的话说一声。' : '收到。', { stopReason: 'stop' });

    const all = bot ? this.store.todosOf(bot.id).sort((a, b) => b.updatedAt - a.updatedAt) : [];
    const open = all.filter((t) => t.status !== 'done');
    const latest = open[0];
    const recent = all[0];
    const money = /付|支付|买|订|下单|报销|¥|元/.test(text);
    const cancel = /算了|取消|不用了|不要了|别订|删掉|不办了/.test(text);
    const update = /改|换|变成|加上|早点|晚点|换成|推迟|提前/.test(text) && !!latest;
    const question = /[?？]$|吗$|呢$|怎么|多少|什么时候|哪个/.test(text) && !update && !money;
    const wantsHandoff = /报销|发票/.test(text) && bot?.id !== 'bill' && !!this.store.bot('bill');
    // Pulling a group is a path of its own now (one task must wake the lead and nobody else), so the
    // scripted brain can walk it too: any ask that names two teammates and no group yet.
    const mates = bot ? this.store.data.bots.filter((x) => x.id !== bot.id) : [];
    const wantsGroup = /拉个群|拉群|一起/.test(text) && mates.length >= 2 && !/## 当前群聊/.test(ctx.systemPrompt ?? '');

    // Step 0: land the todo (create / update / close).
    if (toolResults.length === 0) {
      if (routine) return fauxAssistantMessage([fauxToolCall('todo', { action: 'create', title: `例行：${summarize(text.replace(/^【例行任务】/, ''))}`, status: 'doing', summary: '正在跑' })], { stopReason: 'toolUse' });
      if (lateChoice && latest) return fauxAssistantMessage([fauxToolCall('todo', { action: 'update', todoId: latest.id, status: 'doing', summary: `按你的选择继续：${lateChoice[2]}` })], { stopReason: 'toolUse' });
      if (fromBot) return fauxAssistantMessage([fauxToolCall('todo', { action: 'create', title: summarize(text.replace(fromBot[0], '')), status: 'doing', summary: `${fromBot[1]} 转来的` })], { stopReason: 'toolUse' });
      if (cancel && latest) return fauxAssistantMessage([fauxToolCall('todo', { action: 'close', todoId: latest.id, result: '按你的意思取消了。' })], { stopReason: 'toolUse' });
      if (update) return fauxAssistantMessage([fauxToolCall('todo', { action: 'update', todoId: latest.id, status: 'doing', summary: summarize(text) })], { stopReason: 'toolUse' });
      if (question) return fauxAssistantMessage(recent ? `「${recent.title}」${recent.status === 'done' ? '已经办完了' : '现在' + statusText(recent.status)}${recent.status === 'done' && recent.result ? `：${recent.result}` : recent.summary ? `：${recent.summary}` : ''}。` : '手上还没有你交给我的事。直接说要办什么就行。', { stopReason: 'stop' });
      return fauxAssistantMessage([fauxToolCall('todo', { action: 'create', title: summarize(text), status: 'doing', summary: '收到，开始办' })], { stopReason: 'toolUse' });
    }

    const last = toolResults[toolResults.length - 1] as Extract<Message, { role: 'toolResult' }>;
    const lastText = textOf(last.content);
    const todoId = /事项 (\w+)/.exec(lastText)?.[1] ?? latest?.id;

    // Step 1: after landing the todo, decide whether to ask / act / just reply.
    if (toolResults.length === 1 && last.toolName === 'todo') {
      if (cancel) return fauxAssistantMessage('好，这件事我关掉了。', { stopReason: 'stop' });
      if (routine) return fauxAssistantMessage([fauxToolCall('todo', { action: 'close', todoId, result: '例行任务跑完了，没有需要你处理的。' })], { stopReason: 'toolUse' });
      if (lateChoice) return fauxAssistantMessage(`好，按「${lateChoice[2]}」继续办。`, { stopReason: 'stop' });
      if (fromBot) return fauxAssistantMessage(`收到，@${fromBot[1]} 转来的这件我接了。`, { stopReason: 'stop' });
      if (wantsGroup) {
        return fauxAssistantMessage(
          [fauxToolCall('create_group', { title: summarize(text), members: mates.slice(0, 2).map((x) => x.name), summary: text, task: `${text}。各管一段，做完在群里说一声。` })],
          { stopReason: 'toolUse' },
        );
      }
      if (money) {
        const amount = Number(/(\d{2,6})\s*元|¥\s*(\d{2,6})/.exec(text)?.[1] ?? /(\d{2,6})\s*元|¥\s*(\d{2,6})/.exec(text)?.[2] ?? 553);
        if (/酒店|住/.test(text)) {
          return fauxAssistantMessage(
            [fauxToolCall('ask_user', { kind: 'clarify', title: `${summarize(text)}：两个方案`, detail: '都在预算内，离公司近优先', todoId, options: [{ id: 'a', label: '全季·西湖文化广场', hint: `¥${Math.min(amount, 560)} · 步行 8 分`, primary: true }, { id: 'b', label: '亚朵·武林门', hint: `¥${Math.min(amount + 40, 600)} · 步行 12 分` }] })],
            { stopReason: 'toolUse' },
          );
        }
        if (/票|高铁|机票|出差|行程/.test(text)) {
          return fauxAssistantMessage(
            [fauxToolCall('ask_user', { kind: 'clarify', title: `${summarize(text)}：两个方案`, detail: '都是二等座，按你偏好靠窗', todoId, options: [{ id: 'a', label: 'G7325 07:00', hint: `¥${amount} · 55 分`, primary: true }, { id: 'b', label: 'G7331 08:00', hint: `¥${amount} · 58 分` }] })],
            { stopReason: 'toolUse' },
          );
        }
        return fauxAssistantMessage([fauxToolCall('act', { connection: '默认连接', action: 'pay', summary: summarize(text), amount, todoId })], { stopReason: 'toolUse' });
      }
      if (update) return fauxAssistantMessage(`改好了：${summarize(text)}。`, { stopReason: 'stop' });
      return fauxAssistantMessage(wantsHandoff ? `记下了，我来办。@账单管家 这笔到时候要报销，抬头用公司的。` : `记下了，我来办。有需要你拍板的再找你。`, { stopReason: 'stop' });
    }

    if (last.toolName === 'create_group') return fauxAssistantMessage(`${lastText.split('，')[0]}，各管一段，出结果我在群里汇总给你。`, { stopReason: 'stop' });

    // Step 2: after a clarify -> act (pay) through the autonomy gate.
    if (last.toolName === 'ask_user') {
      const choice = /用户选择了：(\w+)/.exec(lastText)?.[1];
      if (!choice) return fauxAssistantMessage('好，你先忙，选好了告诉我。', { stopReason: 'stop' });
      if (toolResults.some((t) => t.toolName === 'act')) return fauxAssistantMessage('好。', { stopReason: 'stop' });
      const amount = Number(/(\d{2,6})\s*元|¥\s*(\d{2,6})/.exec(text)?.[1] ?? 553);
      const hotel = /酒店|住/.test(text);
      const label = hotel ? (choice === 'a' ? '全季·西湖文化广场 1 晚' : '亚朵·武林门 1 晚') : `${choice === 'a' ? 'G7325 07:00' : 'G7331 08:00'} 二等座`;
      return fauxAssistantMessage([fauxToolCall('act', { connection: '12306', action: 'book', summary: label, amount: hotel ? Math.min(amount, 560) : amount, todoId })], { stopReason: 'toolUse' });
    }

    // Step 3: after act -> close the todo or report.
    if (last.toolName === 'act') {
      if (/已执行/.test(lastText)) return fauxAssistantMessage([fauxToolCall('todo', { action: 'close', todoId, result: `${lastText.split('。')[0].replace('已执行：', '')}，已办好。` })], { stopReason: 'toolUse' });
      if (/自主度是「只告诉我」/.test(lastText)) return fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'clarify', title: `${summarize(text)}：方案备好了，你来办`, detail: '我只查不付。', todoId, options: [{ id: 'go', label: '我去办', primary: true }, { id: 'later', label: '先放着' }] })], { stopReason: 'toolUse' });
      if (/先放着|暂未确认/.test(lastText)) return fauxAssistantMessage('好，先放着，你想办的时候说一声。', { stopReason: 'stop' });
      if (/已失效/.test(lastText)) return fauxAssistantMessage([fauxToolCall('ask_user', { kind: 'blocked', title: lastText.split('，')[0], detail: '重新登录后我接着办', todoId, options: [{ id: 'relogin', label: '我去重新登录', primary: true }, { id: 'stop', label: '先别办了' }] })], { stopReason: 'toolUse' });
      return fauxAssistantMessage(lastText, { stopReason: 'stop' });
    }

    if (last.toolName === 'todo' && toolResults.length >= 2) {
      return fauxAssistantMessage(wantsHandoff ? `办好了。@账单管家 这笔要报销，抬头用公司的。` : '办好了，记在事项里了。', { stopReason: 'stop' });
    }
    return fauxAssistantMessage('好。', { stopReason: 'stop' });
  }
}

function statusText(s: string) {
  return s === 'doing' ? '在办' : s === 'waiting' ? '等你拍板' : s === 'blocked' ? '卡住了' : s === 'open' ? '排队中' : '已完成';
}
