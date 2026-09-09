import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { ExtensionAPI, InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type, type TSchema } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { decidePermission, isAcpStartFailure, pickOption, PERMISSION_LABEL, type AgentRunner, type McpManager } from '../integrations.ts';
import type { ConnectorManager } from '../connectors.ts';
import { AGENT_IDS, type Card, type Integration } from '../types.ts';
import { config } from '../config.ts';

const SNAPSHOT_LINK = /^- \[Snapshot\]\(([^)]+)\)$/m;
const SNAPSHOT_CAP = 12_000;

/**
 * Playwright MCP writes the post-action page snapshot to a .yml file and only links it, which costs the model a
 * second call (and a second round trip) after every click. Read it back and put it in the result, deepest nodes
 * first to go when it is too big — the bot can browser_find what it needs.
 */
async function inlineSnapshot(text: string, dir: string): Promise<string> {
  const m = SNAPSHOT_LINK.exec(text);
  if (!m) return text;
  const file = isAbsolute(m[1]) ? m[1] : join(dir, m[1]);
  let yml: string;
  try {
    yml = await readFile(file, 'utf8');
  } catch {
    return text;
  }
  const lines = yml.split('\n');
  const indent = (l: string) => l.length - l.trimStart().length;
  let depth = 0;
  for (const l of lines) depth = Math.max(depth, indent(l) / 2);
  let kept = lines;
  let trimmed = false;
  while (kept.join('\n').length > SNAPSHOT_CAP && depth > 2) {
    depth -= 1;
    kept = lines.filter((l) => indent(l) <= depth * 2);
    trimmed = true;
  }
  const body = kept.join('\n').slice(0, SNAPSHOT_CAP * 1.5);
  const note = trimmed ? `\n（快照较大，${depth} 层以下的节点省略了；要找某个元素用 browser_find，要全文用 browser_snapshot）` : '';
  return text.replace(m[0], `\`\`\`yaml\n${body}\n\`\`\`${note}`);
}

const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'x';

/** Integrations granted to this bot, by kind. */
export function grantedIntegrations(c: BotCtx, kind?: Integration['kind']) {
  const ids = new Set(c.bot().integrationIds ?? []);
  return c.store.data.integrations.filter((i) => ids.has(i.id) && (!kind || i.kind === kind));
}

/**
 * MCP: every tool of every granted MCP server becomes a pi tool on this bot, named
 * `<server>__<tool>`. Registration happens at session start and again on refresh() when grants change.
 */
export function mcpExtension(c: BotCtx, mcp: McpManager, connectors: ConnectorManager): InlineExtension & { refresh: () => Promise<void> } {
  let api: ExtensionAPI | undefined;
  const registered = new Set<string>();

  const WRITE_RULE = '这会改变用户外部系统里的数据，调用前先自己判断后果：可逆、只动用户自己的东西、用户刚要求的，直接做；删除、覆盖已有内容、发给别人、付款、改别人的东西、或拿不准能否撤销的，先用 ask_user 说清要做什么再做。绝不用写操作探测权限或「测试一下」——读不到就说读不到。';

  /** Composio toolkits have thousands of tools; the published list is the everyday set. These two reach the rest. */
  const registerLongTail = async (integ: Integration) => {
    if (!api || !(await connectors.hasToolkit(integ.id))) return;
    const base = safe(integ.name);
    const find = `${base}__find_tool`;
    if (!registered.has(find)) {
      registered.add(find);
      api.registerTool({
        name: find,
        label: `${integ.name} · 找工具`,
        description: `【${integ.name}】在 ${integ.name} 的完整工具目录里按用途搜索（目录有几千个工具，你的工具列表只放了常用的几十个）。当列表里没有能办这件事的工具时先搜，拿到 slug 和参数后用 ${base}__call_tool 调用。只读。`,
        promptSnippet: `${integ.name}：列表里没有合适工具时，先 find_tool 搜完整目录`,
        parameters: Type.Object({ query: Type.String({ description: '用途关键词，英文效果更好，例：fork repository / list stargazers / update issue' }) }),
        async execute(_id, p) {
          const hits = await connectors.searchTools(integ.id, p.query, 8);
          if (!hits.length) return { content: [{ type: 'text', text: '没有匹配的工具，换个说法再搜。' }], details: { integration: integ.id, query: p.query } };
          const text = hits.map((h) => `${h.slug}${h.write ? '（写操作）' : '（只读）'}\n  ${h.description}\n  参数：${h.params.join('、') || '无'}`).join('\n');
          return { content: [{ type: 'text', text }], details: { integration: integ.id, query: p.query } };
        },
      });
    }
    const call = `${base}__call_tool`;
    if (!registered.has(call)) {
      registered.add(call);
      api.registerTool({
        name: call,
        label: `${integ.name} · 调用任意工具`,
        description: `【${integ.name}】按 slug 调用 ${integ.name} 目录里的任意工具（slug 来自 ${base}__find_tool）。带（写操作）标记的 slug：${WRITE_RULE}`,
        promptSnippet: `${integ.name}：用 find_tool 找到的 slug 在这里调用`,
        parameters: Type.Object({ slug: Type.String({ description: '工具 slug，例：GITHUB_FORK_A_REPOSITORY' }), arguments: Type.Optional(Type.Any({ description: '参数对象，按 find_tool 给出的参数名填' })) }),
        async execute(_id, p) {
          const args = p.arguments && typeof p.arguments === 'object' ? (p.arguments as Record<string, unknown>) : {};
          const text = await connectors.callToolBySlug(integ.id, p.slug, args);
          return { content: [{ type: 'text', text: text.slice(0, 40_000) || '（无输出）' }], details: { integration: integ.id, tool: p.slug } };
        },
      });
    }
  };

  const register = async () => {
    if (!api) return;
    for (const integ of grantedIntegrations(c, 'mcp')) {
      if (integ.status !== 'ok' || !integ.tools) continue;
      if (integ.connector) await registerLongTail(integ).catch(() => undefined);
      for (const t of integ.tools) {
        const name = `${safe(integ.name)}__${safe(t.name)}`;
        if (registered.has(name)) continue;
        registered.add(name);
        let schema: TSchema = Type.Object({}, { additionalProperties: true });
        if (integ.connector) schema = (await connectors.toolSchema(integ.id, t.name).catch(() => undefined)) ?? schema;
        else {
          try {
            const raw = await mcp.toolSchema(integ.id, t.name);
            if (raw && raw.type === 'object') schema = raw as unknown as TSchema;
          } catch {
            /* keep permissive schema */
          }
        }
        api.registerTool({
          name,
          label: `${integ.name} · ${t.name}`,
          description: `【${integ.name}${integ.account ? ` · ${integ.account}` : ''}${t.write ? ' · 写操作' : ' · 只读'}】${t.description ?? t.name}。用用户的账号和权限执行。${
            t.write ? WRITE_RULE : '只读，不改任何数据，可以放心多次调用。'
          }`,
          promptSnippet: `${integ.name}${t.write ? '（写）' : ''}：${(t.description ?? t.name).split(/[。.\n]/)[0].slice(0, 60)}`,
          parameters: schema,
          async execute(_id, params) {
            if (integ.connector) {
              const text = await connectors.callTool(integ.id, t.name, (params ?? {}) as Record<string, unknown>);
              return { content: [{ type: 'text', text: text.slice(0, 40_000) || '（无输出）' }], details: { integration: integ.id, tool: t.name } };
            }
            const res = await mcp.callTool(integ.id, t.name, (params ?? {}) as Record<string, unknown>);
            const content = Array.isArray(res.content) ? res.content : [];
            let text = content.map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text ?? '' : `[${b.type}]`)).join('\n');
            if (res.isError) throw new Error(text || 'MCP 工具返回错误');
            // The computer's browser: the page snapshot goes in the result instead of a link to a file.
            if (integ.owner === c.botId && integ.name === 'computer') text = await inlineSnapshot(text, join(config.botsDir, c.botId, 'workspace', '_browser'));
            return { content: [{ type: 'text', text: text.slice(0, 40_000) || '（无输出）' }], details: { integration: integ.id, tool: t.name } };
          },
        });
      }
    }
  };

  return {
    name: 'crew-mcp',
    factory: (pi) => {
      api = pi;
      // Register at load (grants are already known) and again whenever a session (re)starts.
      void register();
      pi.on('session_start', async () => register());
    },
    refresh: register,
  };
}

/**
 * External agents: one `delegate_agent` tool. The bot hands a self-contained task to Claude Code / Codex / Hermes /
 * OpenCode / OpenClaw. Over ACP (preferred) we see every tool call, route permission requests to the user as a
 * card, and keep the agent's session for follow-ups; the one-shot CLI is the fallback. Progress shows in the
 * thread as an `agent_run` card.
 */
export function agentExtension(c: BotCtx, runner: AgentRunner): InlineExtension {
  return {
    name: 'crew-agent',
    factory: (pi) => {
      pi.registerTool({
        name: 'delegate_agent',
        label: '交给外部 agent',
        description:
          '把一个需要写代码、跑脚本、批量处理文件或深度调研的任务整体交给一个外部 agent：Claude Code、Codex、Hermes、OpenCode 或 OpenClaw。它在你的专属工作区里独立完成。优先走 ACP：过程里它调了什么工具用户都看得见，需要确认的操作（跑命令、删文件、改工作区外的文件）会变成一张卡片问用户；同一个 agent 的会话会保留，追加任务可以直接说「接着刚才的…」。它看不到你们的聊天记录，任务描述必须自包含：目标、输入在哪、期望产出、约束。',
        promptSnippet: '把编程、脚本、批量文件处理、深度调研任务整体交给外部 agent（Claude Code / Codex / Hermes / OpenCode / OpenClaw）',
        promptGuidelines: [
          '任务规模超过几行命令、需要写代码或多步开发时用 delegate_agent；一两条命令能解决的用 bash（若已授权）。',
          '选哪个 agent：用户点名就用那个；否则用「集成」里已开启且可用的第一个。写代码优先 Claude Code / Codex / OpenCode，通用调研和多工具任务 Hermes / OpenClaw 也行。',
          '一次交一个完整任务，等结果回来再决定下一步；追加要求直接再交一次，会接着同一个会话。要彻底重来就 fresh=true。',
          '结果有文件产出时，告诉用户文件在你的工作区里；agent 说没登录时，把 loginHint 里的那句话原样转给用户。',
          '说明里写着「装在你的电脑上 · 经它调用」的 agent，是借用户电脑上的：电脑关了或电脑上的 EverBot 没开就用不了。报错说电脑不在线时，告诉用户打开电脑上的 EverBot 再试，不要自己反复重试。',
        ],
        parameters: Type.Object({
          agent: StringEnum(AGENT_IDS),
          task: Type.String({ description: '完整的任务描述：目标、输入、期望产出、约束' }),
          fresh: Type.Optional(Type.Boolean({ description: 'true = 不接上次的会话，从头开始' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p, signal, onUpdate) {
          const integ = grantedIntegrations(c, 'agent').find((i) => i.agent === p.agent);
          if (!integ) throw new Error(`这个 bot 没有被授权使用 ${p.agent}；请用户在「Bot 配置 › 连接 › 外部 agent」里打开。`);
          if (!integ.available) throw new Error(`${integ.name} 现在用不了：${integ.note ?? ''}`);
          const cwd = runner.workspaceFor(c.botId);
          const threadId = c.current()?.threadId ?? (`bot:${c.botId}` as const);
          // Via the user's computer everything streams the same way; the card says where it runs.
          const useAcp = !!integ.acp || !!integ.viaHost;
          const head = p.task.length > 100 ? `${p.task.slice(0, 100)}…` : p.task;
          const msg = c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `交给 ${integ.name}：${head}`, ts: Date.now(), card: { type: 'agent_run', agent: p.agent, name: integ.name, title: head, mode: useAcp ? 'acp' : 'cli', state: 'running', log: integ.viaHost ? [`在你的电脑「${integ.viaHost}」上运行`] : [], asked: 0, viaHost: integ.viaHost } });
          const log: string[] = [];
          let text = '';
          let asked = 0;
          let last = 0;
          const patch = (x: Partial<Extract<Card, { type: 'agent_run' }>>) => {
            const cur = c.store.message(msg.id)?.card;
            if (cur?.type === 'agent_run') c.store.patchMessage(msg.id, { card: { ...cur, ...x } });
          };
          const flush = (force = false) => {
            if (!force && Date.now() - last < 300) return;
            last = Date.now();
            patch({ log: log.slice(-200), output: text.slice(-1500), asked });
          };
          if (integ.viaHost) log.push(`在你的电脑「${integ.viaHost}」上运行`);
          try {
            let acpFailedToStart = false;
            if (useAcp) {
              let r: Awaited<ReturnType<typeof runner.runAcp>> | undefined;
              try {
                r = await runner.runAcp(
                integ,
                p.task,
                cwd,
                {
                  onText: (t) => {
                    text += t;
                    flush();
                    onUpdate?.({ content: [{ type: 'text', text: text.slice(-2000) }], details: { agent: p.agent, cwd } });
                  },
                  onEvent: (l) => {
                    log.push(l);
                    flush();
                  },
                  permission: async (req) => {
                    const d = decidePermission(req, c.bot().autonomy, cwd);
                    if (d !== 'ask') {
                      log.push(`${d.startsWith('allow') ? '自动允许' : '自动拒绝'}：${req.toolCall.title}`);
                      flush();
                      return pickOption(req, d);
                    }
                    asked++;
                    log.push(`等你拍板：${req.toolCall.title}`);
                    flush(true);
                    const cur = c.current();
                    const detail = req.toolCall.rawInput ? JSON.stringify(req.toolCall.rawInput).slice(0, 300) : (req.toolCall.locations ?? []).map((l) => l.path).join('、');
                    const choice = await c.broker.ask(
                      {
                        botId: c.botId,
                        threadId,
                        via: cur?.via,
                        matterId: cur?.matterId,
                        todoId: cur?.todoId,
                        kind: 'clarify',
                        title: `${integ.name} 想${req.toolCall.kind === 'execute' ? '执行命令' : req.toolCall.kind === 'delete' ? '删除文件' : '改动'}：${req.toolCall.title}`,
                        detail: detail || undefined,
                        options: req.options.map((o) => ({ id: o.optionId, label: PERMISSION_LABEL[o.kind] ?? o.name, primary: o.kind === 'allow_once' })),
                      },
                      signal,
                    );
                    const picked = req.options.find((o) => o.optionId === choice);
                    log.push(choice ? `你选了：${picked ? (PERMISSION_LABEL[picked.kind] ?? picked.name) : choice}` : '没等到回复，按不允许处理');
                    flush(true);
                    return choice ?? pickOption(req, 'reject_once');
                  },
                },
                signal,
                { fresh: p.fresh, botId: c.botId },
                );
              } catch (e) {
                // Local agent whose ACP adapter could not start it: the plain CLI usually prints the real reason.
                if (integ.viaHost || !isAcpStartFailure(e) || signal?.aborted) throw e;
                acpFailedToStart = true;
                log.push(`ACP 没起来（${(e as Error).message.slice(0, 120)}），改用一次性调用看看原因`);
                flush(true);
              }
              if (r) {
                if (r.viaHost) log.push(r.synced ? '文件已同步回工作区' : '（没有文件带回来）');
                patch({ state: 'done', log: log.slice(-200), output: r.output.slice(-3000), asked });
                const body = r.output.length > 30_000 ? `${r.output.slice(0, 30_000)}\n…（已截断）` : r.output;
                const where = r.viaHost ? `在用户的电脑「${r.viaHost}」上运行${r.synced ? '，它写的文件已同步到你的工作区' : '，只有文字结果'}` : `工作区 ${cwd}`;
                return { content: [{ type: 'text', text: `${integ.name} 完成（${r.stopReason}${r.fresh ? '' : '，接着上次的会话'}），${where}：\n\n${body || '（没有文字输出，看工作区里的文件）'}` }], details: { agent: p.agent, cwd, mode: 'acp', stopReason: r.stopReason, viaHost: r.viaHost } };
              }
            }
            // One-shot CLI: no structure to show, just the stream.
            if (acpFailedToStart) patch({ mode: 'cli' });
            const { output, code } = await runner.run(
              integ,
              p.task,
              cwd,
              (t) => {
                text += t;
                flush();
                onUpdate?.({ content: [{ type: 'text', text: text.slice(-2000) }], details: { agent: p.agent, cwd } });
              },
              signal,
            );
            patch({ state: code === 0 || code === null ? 'done' : 'error', output: output.slice(-3000), error: code && code !== 0 ? `退出码 ${code}` : undefined });
            const body = output.length > 30_000 ? `${output.slice(0, 30_000)}\n…（已截断）` : output;
            return { content: [{ type: 'text', text: `${integ.name} 完成（退出码 ${code ?? '?'}），工作区 ${cwd}：\n\n${body || '（无输出）'}` }], details: { agent: p.agent, cwd, mode: 'cli', code } };
          } catch (e) {
            const err = (e as Error).message;
            patch({ state: 'error', error: err, log: log.slice(-200), output: text.slice(-1500), asked });
            throw new Error(`${integ.name} 没做完：${err}${/没登录|login|auth/i.test(err) && integ.loginHint ? `。让用户${integ.loginHint}${integ.viaHost ? '（在他的电脑上）' : ''}` : ''}`);
          }
        },
      });
    },
  };
}
