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
 * Terminal: pi's own bash tool, on for every bot. Commands run in the bot's workspace with a scrubbed
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
        if (!want.fatal) return { ...first, content: [{ type: 'text' as const, text: `(${want.name} was not on this machine; it has been installed. Run it again if you need it.)\n` }, ...first.content] };
        const again = await runBash(toolCallId, params, signal, onUpdate, ctx);
        return { ...again, content: [{ type: 'text' as const, text: `(${want.name} was not on this machine; it has been installed and the command was re-run.)\n` }, ...again.content] };
      },
      description:
        'Run one shell command in your own workspace (a directory of your own) and get the output. Good for: looking through and tidying files there, running a script you already have, simple data work (csv or json with python or jq). Commands time out, output is truncated, and the environment holds no secrets.',
      promptSnippet: 'run a shell command in your own workspace (look at files, run scripts, process data)',
      promptGuidelines: [
        'bash is for files and data in your workspace. Anything that changes the outside world (paying, ordering, sending, editing someone else\'s calendar) goes through act — never route around it with curl.',
        'One command at a time, with a clear purpose. Do not install anything globally, do not reach outside the workspace, and do not print environment variables.',
        'For a longer piece of code or multi-step development, hand it to delegate_agent rather than hand-rolling it in bash.',
        'A manual that ships bin/ or scripts/ (archify, for instance) is run with node or python exactly as the manual says, using the location the skill declares. Reference files that come with a skill are read with bash cat.',
        'Turn the output into one sentence the user understands. Do not paste raw output at them.',
        'Files meant for the user (pages, images, reports, spreadsheets) are written into the current directory (your workspace), never /tmp. Put the full path in your reply and they get a card they can open.',
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
