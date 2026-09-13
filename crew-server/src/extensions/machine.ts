import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { connect as tcpConnect } from 'node:net';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import type { Card, ThreadId } from '../types.ts';
import { loadMachine, machineLink, pairMachine, probeMachine, uploadCode } from '../machine.ts';
import { pathMtu } from '../remote-install.ts';

/**
 * Steward-only tools: eyes and hands on the one machine the user connected. Everything the steward does there
 * shows up in the conversation as a "run" card with the command and its live output, so the user can watch.
 * Credentials never pass through here: the card posts them to the server; outputs come back redacted.
 */
export function machineExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const threadOf = (): ThreadId => c.current()?.threadId ?? (`bot:${c.botId}` as const);

  /** A card that shows one command (or action) running on the machine, with its output streaming in. */
  const runCard = (why: string, command?: string) => {
    const msg = c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: why, ts: Date.now(), card: { type: 'machine', stage: 'run', title: why, command, state: 'running', log: [] } });
    const log: string[] = [];
    const patch = (p: Partial<Extract<Card, { type: 'machine' }>>) => {
      const cur = c.store.message(msg.id)?.card;
      if (cur?.type === 'machine') c.store.patchMessage(msg.id, { card: { ...cur, ...p } });
    };
    let last = 0;
    return {
      line(l: string) {
        log.push(l);
        if (Date.now() - last > 250) {
          last = Date.now();
          patch({ log: log.slice(-400) });
        }
      },
      done(exit: number, error?: string) {
        patch({ log: log.slice(-400), state: exit === 0 && !error ? 'done' : 'error', exit, error });
      },
    };
  };
  const tail = (s: string, n = 6000) => (s.length > n ? `… (${s.length - n} characters above omitted)\n` + s.slice(-n) : s);

  return {
    name: 'crew-machine',
    factory: (pi) => {
      pi.registerTool({
        name: 'machine_status',
        label: 'Machine status',
        description: 'Where things stand: how many bots are on this computer and whether they still run here; which machine the user connected, whether it is paired, and whether its service is reachable from here. Call it first, every round.',
        promptSnippet: 'where the bots are, whether the target machine is connected, paired and reachable',
        parameters: Type.Object({}),
        async execute() {
          const s = await ops().machineStatus();
          const here = `This computer: ${s.here.hostname} (${s.here.platform}), ${s.here.bots} bots, ${s.here.mode === 'active' ? 'running here' : s.here.mode === 'moved' ? 'moved away' : 'on standby'}`;
          if (!s.target) return { content: [{ type: 'text', text: `${here}\nTarget machine: none yet. The user has not filled in a connection card.` }], details: s };
          const t = s.target;
          const pair = !t.url
            ? 'not paired yet (machine_pair once it is installed)'
            : `paired at ${t.url}; ${t.reachable ? `its service is reachable from here${t.note ? `, but ${t.note}` : ''}` : `port ${t.port} is not reachable from here. ${t.note ?? ''}Have the user add a firewall rule for this machine in the cloud console: protocol TCP, port ${t.port}, any source — then machine_probe again.`}`;
          return { content: [{ type: 'text', text: `${here}\nTarget machine: ${t.user}@${t.host} (${t.name}), connected ${new Date(t.connectedAt).toLocaleString('sv-SE', { hour12: false })}; ${pair}` }], details: s };
        },
      });

      pi.registerTool({
        name: 'machine_card',
        label: 'Send a machine card',
        description:
          'Put a card in the thread for the user to act on. stage=connect is the connection card: they fill in the machine\'s public IP, login username and password, and press connect. The password is stored in this computer\'s credential file (never through you), and the system sends you the machine\'s health report. stage=move is the move card: it moves every bot on this computer onto the paired, reachable machine, and all they do is press it.',
        promptSnippet: 'send a connection card (IP / account / password) or a move card (one press moves the bots)',
        promptGuidelines: [
          'Never have the user put a password in the thread. There is exactly one way to ask for one: machine_card(stage=connect).',
          'Once a card is out, do not send another. The system tells you when they have filled it in or pressed it. Send a second only if they say the card failed or they want a different machine.',
          'Before a move card, machine_pair has to have succeeded and machine_probe has to show the service reachable from outside. Otherwise fix that first.',
        ],
        parameters: Type.Object({
          stage: StringEnum(['connect', 'move'] as const),
          title: Type.Optional(Type.String({ description: 'the card title; there is a sensible default' })),
          user: Type.Optional(Type.String({ description: 'connect: the default username. Tencent Lighthouse uses ubuntu; Alibaba and most others use root' })),
        }),
        async execute(_id, p) {
          if (p.stage === 'connect') {
            c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: `${p.title ?? 'Fill in that machine here'}. The password only ever goes into this computer's credential file; I cannot see it.`, ts: Date.now(), card: { type: 'machine', stage: 'connect', title: p.title ?? 'Connect that machine', user: p.user, state: 'idle' } });
            return { content: [{ type: 'text', text: 'The connection card is in the thread. Once they fill it in and press connect, the system sends you the result and the machine health report. Do not chase it — end the turn.' }], details: { stage: 'connect' } };
          }
          const s = await ops().machineStatus();
          if (!s.target?.url) throw new Error('that machine is not paired yet: install first, then machine_pair');
          if (!s.target.reachable) throw new Error(`port ${s.target.port} on that machine is not reachable from outside; walk the user through opening the firewall, then machine_probe again`);
          c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: p.title ?? `Everything is ready. One press moves the bots onto "${s.target.name}".`, ts: Date.now(), card: { type: 'machine', stage: 'move', title: p.title ?? `Move to "${s.target.name}"`, state: 'idle', target: { url: s.target.url, name: s.target.name, bots: s.here.bots } } });
          return { content: [{ type: 'text', text: 'The move card is in the thread. The system carries it out when they press it, and afterwards the App switches to the new machine and you carry on over there. Do not chase it — end the turn.' }], details: { stage: 'move' } };
        },
      });

      pi.registerTool({
        name: 'machine_probe',
        label: 'Probe the network',
        description: 'The network to that machine as seen from this computer: whether port 22 answers; whether large packets (1500 bytes) get through — if they do not and small ones do, that is an MTU black hole, every upload and the App\'s own connection will stall, and that machine\'s MTU has to come down (see the manual); and, once paired, whether its service port is reachable from outside. Run it before uploading, after installing, and after the user says they opened the firewall.',
        promptSnippet: 'probe that machine from outside: ssh, large packets (MTU), and whether the service port is open',
        parameters: Type.Object({}),
        async execute() {
          const m = loadMachine();
          if (!m) throw new Error('no machine is connected yet');
          const ssh = await new Promise<boolean>((resolve) => {
            const s = tcpConnect({ host: m.host, port: m.port || 22, timeout: 5000 });
            s.once('connect', () => (s.destroy(), resolve(true)));
            s.once('timeout', () => (s.destroy(), resolve(false)));
            s.once('error', () => resolve(false));
          });
          const mtu = await pathMtu(m.host);
          const mtuText = mtu === 'ok' ? 'large packets get through (MTU is fine)' : mtu === 'low' ? '1500-byte packets do not get through but 1200-byte ones do: an MTU black hole. Run the manual\'s MTU command on that machine first (1300), and pass CREW_MTU=1300 to the installer' : 'the packet probe was inconclusive (ICMP is blocked); if an upload stalls, treat it as an MTU black hole';
          let svc = 'service: not paired yet';
          if (m.url && m.token) {
            const p = await probeMachine({ url: m.url, token: m.token });
            svc = p.reachable ? `service ${m.url}: reachable from outside${p.note ? `, but ${p.note}` : ''}` : `service ${m.url}: not reachable from outside (${p.note ?? ''})`;
          }
          return { content: [{ type: 'text', text: `ssh (port ${m.port || 22}): ${ssh ? 'open' : 'no answer'}\n${mtuText}\n${svc}` }], details: { ssh, mtu } };
        },
      });

      pi.registerTool({
        name: 'machine_ssh',
        label: 'Run on that machine',
        description:
          'Run one shell command on that machine — that machine only, never this computer — and get the exit code and output. sudo works directly; the system answers for the password. The command and its output appear as a card in the thread, where the user can see them. Give long jobs (the installer, installing Docker) enough timeout_s, up to 1800. The installer is: sudo env CREW_MTU=<when needed> bash /opt/crew/crew-server/deploy/install.sh.',
        promptSnippet: 'run a command on that machine: health checks, dependencies, the installer, configuration, logs',
        promptGuidelines: [
          'One command, one thing. Read the output before deciding the next. On an error, read the cause before fixing it — never blindly re-run.',
          'Never echo or save a password or a token in a command, and do not cat .env (the system masks it, and there is no reason to).',
          'Do nothing unrelated to installing, diagnosing or maintaining this machine, and never delete user data (/data, the docker volume crew-data).',
        ],
        parameters: Type.Object({
          command: Type.String({ description: 'a shell command, bash syntax' }),
          why: Type.String({ description: 'one line for the user on what this step is doing, like "installing Docker" or "finding out why it will not start"' }),
          timeout_s: Type.Optional(Type.Number({ description: 'how long to wait, in seconds; defaults to 120, up to 1800' })),
        }),
        async execute(_id, p) {
          const l = machineLink();
          const card = runCard(p.why, p.command);
          try {
            const r = await l.exec(p.command, { pty: true, timeoutMs: Math.min(Math.max(p.timeout_s ?? 120, 5), 1800) * 1000, onLine: (x) => card.line(x) });
            card.done(r.code, r.timedOut ? `no result after ${p.timeout_s ?? 120}s; aborted` : undefined);
            return { content: [{ type: 'text', text: `exit ${r.code}${r.timedOut ? ' (aborted on timeout)' : ''}\n${tail(r.out) || '(no output)'}` }], details: { code: r.code, timedOut: r.timedOut } };
          } catch (e) {
            card.done(1, (e as Error).message);
            throw e;
          }
        },
      });

      pi.registerTool({
        name: 'machine_upload',
        label: 'Upload the code',
        description: 'Put this product\'s server code on that machine at /opt/crew/crew-server (code only, about 200 KB; the machine pulls the skill library from GitHub during its build). Skipped when the machine already has the same copy. A stalled upload is usually an MTU black hole — machine_probe first.',
        promptSnippet: 'put the server code on that machine',
        parameters: Type.Object({}),
        async execute() {
          const l = machineLink();
          const card = runCard('Putting the server code on that machine', 'upload → /opt/crew/crew-server');
          try {
            const r = await uploadCode(l, (x) => card.line(x));
            card.done(0);
            return { content: [{ type: 'text', text: r.skipped ? 'That machine already has this code; nothing was re-sent. Next, run the installer.' : `Code is in place at /opt/crew/crew-server (${(r.bytes / 1024).toFixed(0)} KB). Next, run the installer.` }], details: r };
          } catch (e) {
            card.done(1, (e as Error).message);
            throw e;
          }
        },
      });

      pi.registerTool({
        name: 'machine_pair',
        label: 'Pair',
        description: 'Call this once the installer has succeeded: it reads the service address and pairing token back off that machine into this computer\'s credential file (you never see the token) and tests once from outside whether the service answers. After that machine_status / machine_probe can see the service, and only then can a move card be sent.',
        promptSnippet: 'pair after installing: record the service address and test it from outside',
        parameters: Type.Object({}),
        async execute() {
          const l = machineLink();
          const r = await pairMachine(l);
          const text = r.reachable ? `Paired: "${r.name}" ${r.url}, reachable from outside. The move card can go out.` : `Paired: "${r.name}" ${r.url}, but port ${r.port} is not reachable from outside (${r.note ?? ''}). Have the user add a firewall rule for this machine in the cloud console: protocol TCP, port ${r.port}, any source — then machine_probe again.`;
          return { content: [{ type: 'text', text }], details: r };
        },
      });
    },
  };
}
