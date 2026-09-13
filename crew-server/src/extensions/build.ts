import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import { CHANNEL_LABEL, channelFromName, type Bot, type Channel } from '../types.ts';
import { IMS } from '../channels.ts';
import { join } from 'node:path';
import type { SkillStore } from '../skills.ts';


type Details = { jobId?: string; aspect: string; action: string; label?: string };

/** Aspects that are things to acquire rather than text to write. */
const EQUIPPABLE = ['skill', 'mcp', 'service', 'agent', 'channel', 'assets'];

/**
 * build: everything the bot is and has. Who it is (name, tagline, soul, instructions), what it knows (skills,
 * routines) and what it can reach (MCP servers, one-click services, external agents, IM channels, asset packs).
 * One door on purpose — a bot builds itself, and splitting "write a manual" from "install the thing the manual
 * needs" is what left bots holding manuals they could not run.
 *   rewrite  (default, text aspects) the bot rewrites it itself, asynchronously, from what happened
 *   set      apply an exact value right away
 *   add      equip something: a pool slug, or a hand-written MCP connection
 *   remove   drop it
 * The only thing that is not build's: what it knows about the user (remember), and product settings like notify,
 * autonomy, pinning and groups (configure).
 */
export function buildExtension(c: BotCtx, skills: () => SkillStore, ops: () => CrewOps): InlineExtension {
  return {
    name: 'crew-build',
    factory: (pi) => {
      pi.registerTool({
        name: 'build',
        label: 'Build',
        description:
          'Build yourself: who you are, what you can do, what you can reach — all of it is here.\nText (action=rewrite to reconsider and rewrite, set to write verbatim): name, tagline, soul (character), instructions (remit and way of working), skill (a manual), routine (a recurring task).\nEquipment (action=add to install, remove to drop): skill mounts a manual from the pool (value = its slug); mcp connects an external tool (value = a slug from the pool — MCP servers and one-click platforms like Gmail, GitHub and Notion are all in there; only write {name, command|url, env?} yourself when the pool has nothing); service is the same as mcp with a platform slug; agent takes an external coding agent (value = claude-code / codex / hermes / opencode / openclaw); channel puts you on a messenger (value = WeChat / Feishu / WeCom / Slack / Telegram; WeChat sends a QR code to scan, the rest send a credential card); assets downloads an asset pack (value = a slug from the pool).\nBefore installing anything, library(search) for candidates and read the manual first: finding something is not a reason to install it. Follow it once without installing; install only what is worth carrying. Use this when the user corrected your method, when the same kind of task arrives a second time, when what you have cannot produce something decent and the pool has something that can, or when the user directly asks you to change your name, add a recurring task or connect a service. Do not use it for a one-off instruction (just do it), for facts about the user (remember), or for notifications, autonomy, pinning and group membership (configure).',
        promptSnippet: 'build yourself: name / character / way of working / skills / recurring tasks, and install tools, services, messengers and asset packs (add)',
        promptGuidelines: [
          'A rewrite needs grounds: the user corrected you, or the same situation has come up at least twice. One compliment or one coincidence is not enough.',
          'Being newly born is the exception: your name, remit and character were inferred from one sentence and have never met real work. If the first few turns show something is off — the work is not what you were told, the boundary is too wide or too narrow, the tone is wrong, what they actually want is something else — rewrite on the spot. Do not wait for a second occurrence.',
          'One aspect at a time. trigger says what happened and which words; change says what it should become, concretely enough to write from.',
          'When the user gives you the words ("change your character to: …", "you are called Sam now"), set them verbatim. When they give you a direction ("stop being so formal", "lead with the conclusion"), rewrite it yourself.',
          'After calling rewrite, carry on with what you were doing — do not wait for it. Half a sentence in your reply is plenty ("adjusting how I do that"), and do not elaborate unless asked.',
          'skill: reusing an existing name rewrites that manual, a new name creates one; a manual is a set of steps for your future self. A routine schedule is only recognised in these shapes: "daily 20:30", "Monday 09:00", "weekdays 18:00", "every 30 minutes", "hourly". When the user says "this one only goes to Telegram", pass channels.',
          'There is one path to installing: library(search) for candidates, read the manual to see whether it is worth it, then build(action=add, value=slug) — manuals, tools and asset packs alike. Finding something is not a reason to install it: follow it once this time, and install only when the same kind of work keeps arriving. Dependencies are installed for you, and when they cannot be, you are told exactly what is missing.',
          'Once installed, carry straight on. Do not report what you installed. Anything needing a key raises a card by itself; the system tells you when it is filled in, so do not chase it.',
          'If this turn you installed more than one thing, pulled off something you could not do before, and the pool has no manual for that combination, write one with build(aspect=skill, rewrite): the situation, what you used, how to check it worked. Following a single existing manual does not need one.',
        ],
        parameters: Type.Object({
          aspect: StringEnum(['name', 'tagline', 'soul', 'instructions', 'skill', 'routine', 'mcp', 'service', 'agent', 'channel', 'assets'] as const),
          action: Type.Optional(StringEnum(['rewrite', 'set', 'add', 'remove'] as const)),
          trigger: Type.Optional(Type.String({ description: 'rewrite: what made you want to change, quoting the user or the specific event' })),
          change: Type.Optional(Type.String({ description: 'rewrite: what it should become — what to keep, what to change, what to add' })),
          value: Type.Optional(Type.Any({ description: 'set: the new value (name/tagline/soul/instructions are strings; a routine is {title, schedule, enabled?, channels?}, with channels like ["app"], ["telegram"], ["app","feishu"] — leave it out to go everywhere you are). add: a pool slug, a platform slug, an agent name, a messenger name, or an MCP you wrote yourself as {name, command|url, env?}' })),
          skill: Type.Optional(Type.String({ description: 'the skill name when aspect=skill; with aspect=routine and remove, the task title' })),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'rewrite';
          const b = c.bot();
          const str = (v: unknown) => {
            if (typeof v !== 'string' || !v.trim()) throw new Error('value has to be a non-empty string');
            return v.trim();
          };
          const done = (text: string, extra: Partial<Details> = {}) => ({ content: [{ type: 'text' as const, text }], details: { aspect: p.aspect, action, ...extra } as Details });

          if (action === 'rewrite') {
            if (!['soul', 'instructions', 'skill'].includes(p.aspect))
              throw new Error(`${p.aspect} cannot be rewritten; use ${EQUIPPABLE.includes(p.aspect) ? 'action=add with a slug in value' : 'set with a concrete value'}`);
            if (!p.trigger?.trim() || !p.change?.trim()) throw new Error('rewrite needs trigger and change');
            if (p.aspect === 'skill' && !p.skill?.trim()) throw new Error('aspect=skill needs a skill name');
            const job = await ops().build(c.botId, { aspect: p.aspect as 'soul' | 'instructions' | 'skill', trigger: p.trigger, change: p.change, skill: p.skill?.trim() });
            return done(`Started building "${job.label}". It runs in the background without affecting this conversation, and the user is notified when it lands. Carry on with what you were doing.`, { jobId: job.id, label: job.label });
          }

          const cur = c.current();
          const threadId = cur?.threadId ?? (`bot:${c.botId}` as const);

          if (EQUIPPABLE.includes(p.aspect)) {
            const ref = str(p.value ?? p.skill);
            if (action === 'remove') {
              if (p.aspect === 'channel') {
                const ch = c.store.data.integrations.find((x) => x.kind === 'channel' && (x.name === ref || x.channel === ref));
                if (!ch?.channel || ch.channel === 'app') throw new Error(`no channel called "${ref}"`);
                ops().disconnectChannel(c.botId, ch.channel);
                return done(`Disconnected from ${ch.name}.`);
              }
              const i = c.store.data.integrations.find((x) => x.id === ref || x.name === ref || x.connector === ref.toLowerCase() || x.agent === ref);
              if (!i) throw new Error(`no connection called "${ref}"`);
              c.store.patchBot(c.botId, { integrationIds: (b.integrationIds ?? []).filter((x) => x !== i.id) });
              return done(`Disconnected ${i.name}; its tools are no longer in your list.`);
            }
            if (action !== 'add' && action !== 'set') throw new Error(`${p.aspect} supports add / remove only`);

            if (p.aspect === 'service') {
              const r = await ops().connect(c.botId, threadId, ref, p.trigger);
              return done(r.text, { label: ref });
            }
            if (p.aspect === 'channel') {
              const ch = c.store.data.integrations.find((x) => x.kind === 'channel' && (x.name === ref || x.channel === ref));
              if (!ch?.channel || ch.channel === 'app') throw new Error(`no messenger called "${ref}"; the ones you can connect are: ${c.store.data.integrations.filter((x) => x.kind === 'channel' && x.channel !== 'app').map((x) => x.name).join(', ')}`);
              if (b.im?.[ch.channel]?.status === 'ok') return done(`You are already on ${ch.name}${b.im[ch.channel]?.account ? `, where you are called "${b.im[ch.channel]!.account}"` : ''}.`);
              ops().connectChannel(c.botId, ch.channel, threadId);
              return done(`A credential card is in the thread: the user follows its steps to create a bot for you in ${ch.name}, and once filled in the system connects it and tells you. Do not chase it, and do not ask them to edit a config file.`, { label: ch.name });
            }
            if (p.aspect === 'agent') {
              const i = c.store.data.integrations.find((x) => x.kind === 'agent' && (x.agent === ref || x.name === ref || x.name.toLowerCase() === ref.toLowerCase()));
              if (!i) throw new Error(`no external agent called "${ref}"; this machine has: ${c.store.data.integrations.filter((x) => x.kind === 'agent').map((x) => x.name).join(', ') || '(none at all)'}`);
              if (i.available === false) return done(`${i.name} is not installed on this machine${i.loginHint ? ` (and once installed: ${i.loginHint})` : ''}, so it cannot be connected. Use another, or tell the user.`);
              await ops().grant(c.botId, i.id);
              return done(`${i.name} is yours to use now${i.acp ? ' (you can watch it work)' : ''}. Hand work to it with delegate_agent.`, { label: i.name });
            }
            // skill / mcp / assets: a pool slug, or — for mcp only — a connection written out by hand
            if (p.aspect === 'mcp' && (typeof p.value === 'object' || /[\s{]/.test(ref))) {
              let v: unknown = p.value;
              if (typeof v === 'string') {
                try {
                  v = JSON.parse(v);
                } catch {
                  v = { name: p.skill ?? 'MCP', command: v };
                }
              }
              const o = (v ?? {}) as { name?: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> };
              if (!o.name || (!o.command && !o.url)) throw new Error('writing a connection yourself needs value={name, command|url, env?}; command may carry arguments, like "python3 /path/server.py". If the pool already has one, use build(add, value=slug)');
              let command = o.command;
              let args = o.args;
              if (command && !args?.length) {
                const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [command];
                command = parts[0].replace(/"/g, '');
                args = parts.slice(1).map((x) => x.replace(/"/g, ''));
              }
              const r = await ops().addMcp({ name: o.name, command, args, url: o.url, env: o.env });
              await ops().grant(c.botId, r.id);
              if (r.status === 'ok') return done(`"${o.name}" is connected, and its ${r.tools ?? 0} tools are in your list.`, { label: o.name });
              return done(`"${o.name}" was created (id ${r.id}), status ${r.status}: ${r.note ?? ''}. If a credential is missing, send a card with request_credentials; if not, check the command and the path.`, { label: o.name });
            }
            if (p.aspect === 'skill') {
              // The model sees its own manuals listed by pi slug (s-xxxx) and reaches for build to "load" one. Nothing to
              // install: point it at the file.
              const owned = b.skills.find((n) => n === ref || skills().slugFor(n) === ref);
              if (owned) return done(`"${owned}" is already yours; nothing to install. The manual is at ${join(skills().dirFor(owned), 'SKILL.md')} — read it and follow it.`, { label: owned });
            }
            const r = await ops().equip(c.botId, ref, threadId);
            return done(r.text, { label: ref });
          }

          const patch: Partial<Bot> = {};
          switch (p.aspect) {
            case 'name':
              if (action === 'remove') throw new Error('a name cannot be removed');
              patch.name = str(p.value).slice(0, 12);
              break;
            case 'tagline':
              patch.tagline = action === 'remove' ? '' : str(p.value).slice(0, 40);
              break;
            case 'soul':
              patch.soul = action === 'remove' ? '' : str(p.value).slice(0, 400);
              break;
            case 'instructions':
              if (action === 'remove') throw new Error('a remit cannot be emptied; rewrite it instead');
              patch.role = str(p.value).slice(0, 800);
              break;
            case 'skill': {
              const name = (p.skill ?? (typeof p.value === 'string' ? p.value : '')).trim();
              if (!name) throw new Error('needs a skill name');
              if (action === 'remove') patch.skills = b.skills.filter((s) => s !== name);
              else throw new Error('a manual cannot be set verbatim; use rewrite and write it yourself');
              break;
            }
            case 'routine': {
              if (action === 'remove') {
                const t = (typeof p.value === 'string' ? p.value : (p.value as { title?: string })?.title) ?? p.skill;
                if (!t) throw new Error('removing a routine needs its title');
                patch.routines = b.routines.filter((r) => r.title !== t && r.id !== t);
              } else {
                const v = p.value as { title?: string; prompt?: string; schedule?: string; enabled?: boolean; channels?: string[] } | undefined;
                if (!v?.title || !v?.schedule) throw new Error('setting a routine needs value={title, schedule}, with schedule like "daily 20:30", "Monday 09:00", "weekdays 18:00", "every 30 minutes"; what to do when it fires can go in prompt');
                // Where the result goes. 'app' is always available; an IM only if this bot is actually on it.
                const here: Channel[] = ['app', ...IMS.filter((ch) => b.im?.[ch]?.status === 'ok')];
                const channels = v.channels?.length
                  ? v.channels.map((raw) => {
                      const want = String(raw).trim().toLowerCase();
                      const ch = here.find((x) => x === want || channelFromName(String(raw)) === x);
                      if (!ch) throw new Error(`cannot deliver to "${raw}". Right now you can reach: ${here.map((x) => CHANNEL_LABEL[x]).join(', ')}${here.length === 1 ? ' (to reach a messenger, build(aspect=channel, action=add) first)' : ''}`);
                      return ch;
                    })
                  : undefined;
                const existing = b.routines.find((r) => r.title === v.title);
                // `lastRun` starts at now: a schedule whose time already passed today should wait for tomorrow.
                patch.routines = existing
                  ? b.routines.map((r) =>
                      r.title === v.title
                        ? { ...r, schedule: v.schedule!, prompt: v.prompt ?? r.prompt, enabled: v.enabled ?? r.enabled, channels: channels ?? r.channels, lastRun: v.schedule === r.schedule ? r.lastRun : Date.now() }
                        : r,
                    )
                  : [...b.routines, { id: Math.random().toString(36).slice(2, 10), title: v.title, schedule: v.schedule, ...(v.prompt ? { prompt: v.prompt } : {}), enabled: v.enabled ?? true, lastRun: Date.now(), ...(channels ? { channels } : {}) }];
              }
              break;
            }
          }
          c.store.patchBot(c.botId, patch);
          const what = { name: 'Name', tagline: 'Tagline', soul: 'Character', instructions: 'Way of working', skill: 'Skill', routine: 'Recurring task', mcp: 'External tool', service: 'Service', agent: 'External agent', channel: 'Channel', assets: 'Asset pack' }[p.aspect];
          return done(`${what} ${action === 'remove' ? 'removed' : 'updated'}. It is already live in the interface.`);
        },
      });
    },
  };
}
