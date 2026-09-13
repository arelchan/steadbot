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
  const note = trimmed ? `\n(Large snapshot; nodes below level ${depth} were dropped. Use browser_find for one element, browser_snapshot for the whole thing.)` : '';
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

  const WRITE_RULE = 'This changes data in the user\'s external system, so weigh the consequence before calling it: reversible, touching only their own things, just asked for — go ahead. Deleting, overwriting, sending to other people, paying, changing someone else\'s things, or anything you are unsure you can undo — say plainly what you are about to do with ask_user first. Never probe permissions with a write or "just test it": if you cannot read something, say you cannot.';

  /** Composio toolkits have thousands of tools; the published list is the everyday set. These two reach the rest. */
  const registerLongTail = async (integ: Integration) => {
    if (!api || !(await connectors.hasToolkit(integ.id))) return;
    const base = safe(integ.name);
    const find = `${base}__find_tool`;
    if (!registered.has(find)) {
      registered.add(find);
      api.registerTool({
        name: find,
        label: `${integ.name} · find a tool`,
        description: `[${integ.name}] Search ${integ.name}'s full tool catalogue by purpose (it holds thousands; your tool list carries only the few dozen common ones). When nothing in your list can do the job, search here first, then call it with ${base}__call_tool using the slug and parameters you get back. Read-only.`,
        promptSnippet: `${integ.name}: when your list has nothing suitable, find_tool searches the full catalogue`,
        parameters: Type.Object({ query: Type.String({ description: 'keywords for what you want to do, such as fork repository / list stargazers / update issue' }) }),
        async execute(_id, p) {
          const hits = await connectors.searchTools(integ.id, p.query, 8);
          if (!hits.length) return { content: [{ type: 'text', text: 'No tool matched; search again with different words.' }], details: { integration: integ.id, query: p.query } };
          const text = hits.map((h) => `${h.slug}${h.write ? ' (write)' : ' (read-only)'}\n  ${h.description}\n  parameters: ${h.params.join(', ') || 'none'}`).join('\n');
          return { content: [{ type: 'text', text }], details: { integration: integ.id, query: p.query } };
        },
      });
    }
    const call = `${base}__call_tool`;
    if (!registered.has(call)) {
      registered.add(call);
      api.registerTool({
        name: call,
        label: `${integ.name} · call any tool`,
        description: `[${integ.name}] Call any tool in ${integ.name}'s catalogue by slug (slugs come from ${base}__find_tool). For a slug marked (write): ${WRITE_RULE}`,
        promptSnippet: `${integ.name}: call the slug find_tool gave you`,
        parameters: Type.Object({ slug: Type.String({ description: 'the tool slug, e.g. GITHUB_FORK_A_REPOSITORY' }), arguments: Type.Optional(Type.Any({ description: 'the arguments object, using the parameter names find_tool gave' })) }),
        async execute(_id, p) {
          const args = p.arguments && typeof p.arguments === 'object' ? (p.arguments as Record<string, unknown>) : {};
          const text = await connectors.callToolBySlug(integ.id, p.slug, args);
          return { content: [{ type: 'text', text: text.slice(0, 40_000) || '(no output)' }], details: { integration: integ.id, tool: p.slug } };
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
          description: `[${integ.name}${integ.account ? ` · ${integ.account}` : ''}${t.write ? ' · write' : ' · read-only'}] ${t.description ?? t.name}. Runs as the user, with their permissions. ${
            t.write ? WRITE_RULE : 'Read-only: it changes nothing, so call it as often as you need.'
          }`,
          promptSnippet: `${integ.name}${t.write ? ' (write)' : ''}: ${(t.description ?? t.name).split(/[。.\n]/)[0].slice(0, 60)}`,
          parameters: schema,
          async execute(_id, params) {
            if (integ.connector) {
              const text = await connectors.callTool(integ.id, t.name, (params ?? {}) as Record<string, unknown>);
              return { content: [{ type: 'text', text: text.slice(0, 40_000) || '(no output)' }], details: { integration: integ.id, tool: t.name } };
            }
            const res = await mcp.callTool(integ.id, t.name, (params ?? {}) as Record<string, unknown>);
            const content = Array.isArray(res.content) ? res.content : [];
            let text = content.map((b: { type: string; text?: string }) => (b.type === 'text' ? b.text ?? '' : `[${b.type}]`)).join('\n');
            if (res.isError) throw new Error(text || 'the MCP tool returned an error');
            // The computer's browser: the page snapshot goes in the result instead of a link to a file.
            if (integ.owner === c.botId && integ.name === 'computer') text = await inlineSnapshot(text, join(config.botsDir, c.botId, 'workspace', '_browser'));
            return { content: [{ type: 'text', text: text.slice(0, 40_000) || '(no output)' }], details: { integration: integ.id, tool: t.name } };
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
        label: 'Hand it to an external agent',
        description:
          'Hand a whole task that needs code, scripts, bulk file work or deep research to an external agent: Claude Code, Codex, Hermes, OpenCode or OpenClaw. It works on its own inside your workspace. ACP is preferred: the user sees every tool it calls, and anything needing approval (running a command, deleting a file, touching something outside the workspace) becomes a card for them. The session with that agent persists, so a follow-up can simply continue from the last one. It cannot see your conversation, so the task has to stand alone: the goal, where the input is, what you expect back, the constraints.',
        promptSnippet: 'hand coding, scripting, bulk file work or deep research to an external agent (Claude Code / Codex / Hermes / OpenCode / OpenClaw)',
        promptGuidelines: [
          'Use delegate_agent when the work is more than a few lines of shell, needs code, or takes several steps. One or two commands go to bash.',
          'Which agent: the one the user named, otherwise the first enabled and available under Integrations. For writing code, prefer Claude Code / Codex / OpenCode; for general research and many-tool work, Hermes / OpenClaw do fine.',
          'Hand over one whole task and wait for the result before deciding the next step. A follow-up is simply another handover and continues the same session; to start clean, fresh=true.',
          'When the result includes files, tell the user they are in your workspace. When the agent says it is not logged in, pass the line in loginHint to them verbatim.',
          'An agent described as "installed on your computer · called through it" is borrowed from the user\'s machine: with the computer off, or Steadbot not running on it, it is unavailable. When the error says the computer is offline, tell them to start Steadbot on it and try again — do not keep retrying yourself.',
        ],
        parameters: Type.Object({
          agent: StringEnum(AGENT_IDS),
          task: Type.String({ description: 'the whole task: the goal, the input, what you expect back, the constraints' }),
          fresh: Type.Optional(Type.Boolean({ description: 'true = do not continue the last session; start clean' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p, signal, onUpdate) {
          const integ = grantedIntegrations(c, 'agent').find((i) => i.agent === p.agent);
          if (!integ) throw new Error(`this bot is not allowed to use ${p.agent}; ask the user to enable it under Bot settings › Connections › External agents.`);
          if (!integ.available) throw new Error(`${integ.name} is unavailable right now: ${integ.note ?? ''}`);
          const cwd = runner.workspaceFor(c.botId);
          const threadId = c.current()?.threadId ?? (`bot:${c.botId}` as const);
          // Via the user's computer everything streams the same way; the card says where it runs.
          const useAcp = !!integ.acp || !!integ.viaHost;
          const head = p.task.length > 100 ? `${p.task.slice(0, 100)}…` : p.task;
          const msg = c.store.addMessage({ threadId, author: 'bot', botId: c.botId, text: `Handed to ${integ.name}: ${head}`, ts: Date.now(), card: { type: 'agent_run', agent: p.agent, name: integ.name, title: head, mode: useAcp ? 'acp' : 'cli', state: 'running', log: integ.viaHost ? [`running on your computer "${integ.viaHost}"`] : [], asked: 0, viaHost: integ.viaHost } });
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
          if (integ.viaHost) log.push(`running on your computer "${integ.viaHost}"`);
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
                      log.push(`${d.startsWith('allow') ? 'allowed automatically' : 'denied automatically'}: ${req.toolCall.title}`);
                      flush();
                      return pickOption(req, d);
                    }
                    asked++;
                    log.push(`waiting on you: ${req.toolCall.title}`);
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
                        title: `${integ.name} wants to ${req.toolCall.kind === 'execute' ? 'run a command' : req.toolCall.kind === 'delete' ? 'delete a file' : 'make a change'}: ${req.toolCall.title}`,
                        detail: detail || undefined,
                        options: req.options.map((o) => ({ id: o.optionId, label: PERMISSION_LABEL[o.kind] ?? o.name, primary: o.kind === 'allow_once' })),
                      },
                      signal,
                    );
                    const picked = req.options.find((o) => o.optionId === choice);
                    log.push(choice ? `you chose: ${picked ? (PERMISSION_LABEL[picked.kind] ?? picked.name) : choice}` : 'no answer came back; treated as denied');
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
                log.push(`ACP did not start (${(e as Error).message.slice(0, 120)}); falling back to a one-shot call to see why`);
                flush(true);
              }
              if (r) {
                if (r.viaHost) log.push(r.synced ? 'files synced back to the workspace' : '(no files came back)');
                patch({ state: 'done', log: log.slice(-200), output: r.output.slice(-3000), asked });
                const body = r.output.length > 30_000 ? `${r.output.slice(0, 30_000)}\n… (truncated)` : r.output;
                const where = r.viaHost ? `ran on the user's computer "${r.viaHost}"${r.synced ? ', and the files it wrote were synced into your workspace' : ', text result only'}` : `workspace ${cwd}`;
                return { content: [{ type: 'text', text: `${integ.name} finished (${r.stopReason}${r.fresh ? '' : ', continuing the last session'}), ${where}:\n\n${body || '(no text output; look at the files in the workspace)'}` }], details: { agent: p.agent, cwd, mode: 'acp', stopReason: r.stopReason, viaHost: r.viaHost } };
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
            patch({ state: code === 0 || code === null ? 'done' : 'error', output: output.slice(-3000), error: code && code !== 0 ? `exit ${code}` : undefined });
            const body = output.length > 30_000 ? `${output.slice(0, 30_000)}\n… (truncated)` : output;
            return { content: [{ type: 'text', text: `${integ.name} finished (exit ${code ?? '?'}), workspace ${cwd}:\n\n${body || '(no output)'}` }], details: { agent: p.agent, cwd, mode: 'cli', code } };
          } catch (e) {
            const err = (e as Error).message;
            patch({ state: 'error', error: err, log: log.slice(-200), output: text.slice(-1500), asked });
            throw new Error(`${integ.name} did not finish: ${err}${/not logged in|login|auth/i.test(err) && integ.loginHint ? `. Ask the user to ${integ.loginHint}${integ.viaHost ? ' (on their computer)' : ''}` : ''}`);
          }
        },
      });
    },
  };
}
