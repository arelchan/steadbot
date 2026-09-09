import { createBashToolDefinition, type ExtensionAPI, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { ensure, toolsEnv } from '../tools.ts';
import { pipNameFor } from '../requires.ts';

const SECRET = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

/** process.env without anything that looks like a credential, plus whatever this machine has installed for skills. */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!SECRET.test(k)) out[k] = v;
  return toolsEnv(out);
}

/**
 * What a failure says is missing. The scanner cannot see these — they only show up when the code runs — so this is
 * the third source of dependencies, and the only one that never goes stale.
 */
const MISSING: { kind: 'pip' | 'npm'; re: RegExp; name: (m: RegExpMatchArray) => string }[] = [
  { kind: 'pip', re: /ModuleNotFoundError: No module named ['"]([\w]+)/, name: (m) => pipNameFor(m[1]) },
  { kind: 'pip', re: /ImportError: No module named ['"]?([\w]+)/, name: (m) => pipNameFor(m[1]) },
  { kind: 'npm', re: /Cannot find module ['"]((?:@[\w.-]+\/)?[\w.-]+)/, name: (m) => m[1] },
  { kind: 'npm', re: /Error: Cannot find package ['"]((?:@[\w.-]+\/)?[\w.-]+)/, name: (m) => m[1] },
];

const looksMissing = (text: string) => {
  const tail = text.slice(-400);
  for (const p of MISSING) {
    const m = text.match(p.re);
    // A relative path is the skill's own file, not a package: installing `./helpers` would be nonsense.
    if (m && !m[1].startsWith('.')) return { kind: p.kind, name: p.name(m), fatal: p.re.test(tail) };
  }
  return undefined;
};

/**
 * 终端: pi's own bash tool, on for every bot. Commands run in the bot's workspace with a scrubbed
 * environment (no secrets), with a timeout and truncated output.
 */
export function shellExtension(c: BotCtx): InlineExtension & { refresh: () => Promise<void> } {
  let api: ExtensionAPI | undefined;
  let registered = false;
  const workspace = join(config.botsDir, c.botId, 'workspace');

  const register = async () => {
    if (!api || registered) return;
    if (!existsSync(workspace)) mkdirSync(workspace, { recursive: true });
    const def = createBashToolDefinition(workspace, {
      exposeSessionEnvironment: false,
      spawnHook: (ctx) => ({ ...ctx, cwd: workspace, env: sanitizedEnv() }),
    });
    const runBash = def.execute.bind(def);
    api.registerTool({
      ...def,
      /**
       * Run the command; if it died because a package is not here, install it and run it again — once. Before this,
       * a missing package meant the bot improvised around it or gave up, and the machine never learned anything.
       */
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        const first = await runBash(toolCallId, params, signal, onUpdate, ctx);
        const said = first.content.map((b) => (b.type === 'text' ? b.text : '')).join('\n');
        const want = said ? looksMissing(said) : undefined;
        if (!want) return first;
        const r = await ensure({ [want.kind]: [want.name] }, `runtime:${c.botId}`).catch(() => undefined);
        if (!r?.ok) return first;
        // Rerun only when the command clearly died on this: a traceback ends with the error. A command that merely
        // printed one (a log, a test report) may have done real work, and running it twice could undo it.
        if (!want.fatal) return { ...first, content: [{ type: 'text' as const, text: `（${want.name} 刚才不在这台机器上，已经装好了。要用的话再跑一次。）\n` }, ...first.content] };
        const again = await runBash(toolCallId, params, signal, onUpdate, ctx);
        return { ...again, content: [{ type: 'text' as const, text: `（${want.name} 不在这台机器上，已经装好，重跑了一次。）\n` }, ...again.content] };
      },
      description:
        '在你自己的工作区（一个专属目录）里运行一条 shell 命令，返回输出。适合：查看和整理工作区里的文件、跑一段现成脚本、做简单的数据处理（如用 python/jq 处理 csv、json）。命令有超时，输出会截断，环境里没有任何密钥。',
      promptSnippet: '在专属工作区里运行 shell 命令（看文件、跑脚本、处理数据）',
      promptGuidelines: [
        'bash 只用来处理工作区里的文件和数据。改变外部世界的事（付款、下单、发消息、改别人的日程）必须走 act，不要用 curl 绕过去。',
        '一次一条命令、目标明确；不要装全局软件、不要访问工作区以外的目录、不要打印环境变量。',
        '需要写一段较长的代码或多步开发时，交给 delegate_agent，不要在 bash 里手搓。',
        '技能目录里带 bin/ 或 scripts/ 的手册（如 archify），照手册用 node / python 跑它的命令即可，路径用技能声明的 location；读技能附带的参考文件也用 bash cat。',
        '把命令输出翻译成用户能懂的一句话，不要把原始输出整段贴给用户。',
        '要交给用户看的文件（网页、图、报告、表格）生成到当前目录（你的工作区），不要放 /tmp；回复里写出它的完整路径，用户会得到一张能直接打开的文件卡。',
      ],
    });
    registered = true;
  };

  return {
    name: 'crew-shell',
    factory: (pi) => {
      api = pi;
      // Register at load (grants are already known) and again whenever a session (re)starts.
      void register();
      pi.on('session_start', async () => register());
    },
    refresh: register,
  };
}
