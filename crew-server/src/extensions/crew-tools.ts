import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import { CHANNEL_LABEL, type Bot, type BuildAspect, type BuildJob, type Channel, type Matter, type ThreadId, type LibraryEntry } from '../types.ts';
import * as everos from '../everos.ts';

/** Product operations the tools need; implemented in index.ts where the whole system is wired. */
export interface CrewOps {
  /** put the credentials card for one IM into the bot's thread: the bot becomes its own bot over there */
  connectChannel(botId: string, channel: Exclude<Channel, 'app'>, threadId?: ThreadId): void;
  /** take the bot off an IM: stop its account there and forget the credentials */
  disconnectChannel(botId: string, channel: Exclude<Channel, 'app'>): void;
  createBot(brief: string, opts: { name?: string; byBotId: string; task?: string }): Promise<Bot>;
  createGroup(opts: { title: string; summary?: string; memberIds: string[]; leadId: string; task?: string; byBotId: string }): Promise<Matter>;
  addMcp(i: { name: string; command?: string; args?: string[]; url?: string; env?: Record<string, string>; headers?: Record<string, string> }): Promise<{ id: string; status: string; note?: string; tools?: number }>;
  /** give this bot an existing integration (and put its tools in front of it right away) */
  grant(botId: string, integrationId: string): Promise<void>;
  removeIntegration(id: string): void;
  /** start an asynchronous self-build; resolves as soon as the job is registered */
  build(botId: string, spec: BuildSpec): Promise<BuildJob>;
  /** hand the user an authorization card for a built-in connector (or report it's already connected / unavailable) */
  connect(botId: string, threadId: ThreadId, service: string, why?: string): Promise<{ status: 'connected' | 'card' | 'unavailable' | 'unknown'; text: string }>;
  /** lexical search over the curated skill library; empty query lists everything */
  librarySearch(query: string, limit?: number): (LibraryEntry & { categoryLabel: string; kindLabel: string })[];
  /** The same pool, searched by meaning as well as by words (library.ts). One embedding call, so: not per turn. */
  libraryFind(query: string, limit?: number): Promise<(LibraryEntry & { categoryLabel: string; kindLabel: string })[]>;
  /** copy a library skill onto a bot (idempotent) */
  /** Equip this bot with one pool entry, whatever kind it is: mount a manual, connect an MCP server, send a
   *  one-click card, download an asset pack. Installing dependencies is part of it. */
  equip(botId: string, slug: string, threadId: ThreadId): Promise<{ text: string; kind: string }>;
  /** steward only: this machine, and the machine the user is moving the bots to (if one was installed) */
  machineStatus(): Promise<MachineStatus>;
  /** read a credential off a page in the shared browser straight into the bot's IM account / a connection's env (never through the model); or the setup facts for a target */
  harvest(botId: string, spec: { action: 'take' | 'info'; target: string; field?: string; url?: string; selector?: string; near?: string; threadId?: ThreadId }): Promise<string>;
  /** the round trip that proves an IM is really connected: hand out a code, then say whether it came back */
  channelCheck(botId: string, channel: string, action: 'arm' | 'status'): Promise<string>;
  /** a login wall on the shared computer, moved into the conversation: a live QR to scan, or a card to fill */
  askLogin(
    botId: string,
    threadId: ThreadId | undefined,
    spec: { kind: 'qr' | 'password'; url?: string; title?: string; selector?: string; accountSelector?: string; passwordSelector?: string; submitSelector?: string; note?: string },
  ): Promise<string>;
  /** the vigil manager, for the vigil tool */
  vigil(): import('../vigil.ts').VigilManager;
  /** change a bot's avatar: 'regen' | 'reset' | a look description | an image file the bot produced */
  avatar(botId: string, value: string): Promise<string>;
}

export interface MachineStatus {
  here: { hostname: string; platform: string; mode: string; bots: number; local: boolean };
  target?: { name: string; host: string; user: string; connectedAt: number; url?: string; port?: string; pairedAt?: number; reachable?: boolean; note?: string };
}

export interface BuildSpec {
  aspect: BuildAspect;
  trigger: string;
  change: string;
  skill?: string;
}

const ConfigureParams = Type.Object({
  target: StringEnum(['bot', 'matter', 'profile'] as const),
  action: StringEnum(['get', 'set', 'add', 'remove'] as const),
  id: Type.Optional(Type.String({ description: 'the id or name of a bot or a group; defaults to you' })),
  field: Type.Optional(
    Type.String({
      description:
        'bot (product-level settings only): autonomy(tell|prepare|do) | notify | pinned | avatar (regen to redraw, reset for the default, a sentence describing a look, or the absolute path of an image you generated). matter: title | summary | members | lead | notify | pinned. profile: read-only',
    }),
  ),
  value: Type.Optional(Type.Any({ description: 'the new value for set; the entry for add / remove' })),
});

/**
 * Three product-level tools available to every bot:
 *   create_bot   spin up a new teammate from a one-sentence brief (optionally hand it a first task)
 *   create_group pull a group chat around a matter, optionally dropping a task in
 *   configure    every user-configurable thing in the product, atomized: get/set/add/remove
 */
export function crewToolsExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const findBot = (ref?: string): Bot | undefined => {
    if (!ref) return c.bot();
    return c.store.bot(ref) ?? c.store.data.bots.find((b) => b.name === ref.replace(/^@/, ''));
  };
  const findMatter = (ref?: string): Matter | undefined => {
    if (!ref) return c.current()?.matterId ? c.store.matter(c.current()!.matterId!) : undefined;
    return c.store.matter(ref) ?? c.store.data.matters.find((m) => m.title === ref);
  };
  const describeBot = (b: Bot) => {
    const integ = c.store.data.integrations.filter((i) => (b.integrationIds ?? []).includes(i.id)).map((i) => `${i.name}(${i.kind})`);
    return [
      `id: ${b.id}`,
      `name: ${b.name}`,
      `tagline: ${b.tagline}`,
      `way of working (role, changed with build): ${b.role}`,
      `character (soul, changed with build): ${b.soul || '(not written)'}`,
      `autonomy: ${b.autonomy}; notify: ${b.notify}; pinned: ${b.pinned}`,
      `skills: ${b.skills.join(', ') || '(none)'}`,
      `recurring: ${b.routines.map((r) => `${r.title} (${r.schedule}${r.channels?.length ? `, to ${r.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(', ')}` : ''}${r.enabled ? '' : ', disabled'})`).join('; ') || '(none)'}`,
      `integrations: ${integ.join(', ') || '(none)'}`,
      `IM: ${
        Object.entries(b.im ?? {})
          .map(([ch, l]) => `${CHANNEL_LABEL[ch as Channel] ?? ch} (${l?.status === 'ok' ? `connected${l.account ? `, known there as "${l.account}"` : ''}` : l?.status === 'connecting' ? 'connecting' : `not connected: ${l?.note ?? ''}`})`)
          .join('; ') || '(no messenger connected; connect one with build(aspect=channel, action=add, value="Feishu"))'
      }`,
      `about the user (the shared profile): ${(everos.profileDoc()?.explicit ?? []).map((e) => e.description).join('; ') || '(nothing has settled yet)'}`,
    ].join('\n');
  };

  return {
    name: 'crew-tools',
    factory: (pi) => {
      pi.registerTool({
        name: 'create_bot',
        label: 'Create a bot',
        description:
          'Create a new long-lived bot for the user — one more dedicated colleague on the team. Give one sentence in the user\'s own voice saying what it looks after, and the system generates its name, remit, skills and avatar; seconds later it can take work. You can hand it a first task at the same time.',
        promptSnippet: 'create a new dedicated bot (optionally with its first task)',
        promptGuidelines: [
          'Two situations only: the user explicitly wants a new dedicated bot, or something clearly outside your remit will keep coming back and no existing bot fits (check with configure(target=bot, action=get) first).',
          'Never create one for a one-off, and never when an existing bot can take it by @-mention. You do not need to ask before creating, but once it exists say what it is called and what it looks after.',
        ],
        parameters: Type.Object({
          brief: Type.String({ description: 'what it looks after, in the user\'s voice — "watch what our competitors ship and give me one page every Friday"' }),
          name: Type.Optional(Type.String({ description: 'a name, if you want one; the system picks otherwise' })),
          task: Type.Optional(Type.String({ description: 'a first task to hand it at the same time' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p) {
          const bot = await ops().createBot(p.brief, { name: p.name, byBotId: c.botId, task: p.task });
          return { content: [{ type: 'text', text: `Created "${bot.name}" (id ${bot.id}): ${bot.role}${p.task ? ' The first task was handed over.' : ''} You can reach it with @${bot.name} in a reply.` }], details: { botId: bot.id } };
        },
      });

      pi.registerTool({
        name: 'create_group',
        label: 'Open a group',
        description:
          'Open a group for something that takes several people, with the user in it. Name the members (by name or id), optionally a lead (you by default), and either drop the task in at the same time or just open the group. Everything said there is visible to every member, but only the bot that is @-mentioned wakes up to answer; the lead pushes it along and pulls it together. The result stays on that thread, where you and the user can both see it.',
        promptSnippet: 'work that takes several people: open a group so everyone and the user share one thread (optionally with a task)',
        promptGuidelines: [
          'When part of a job is outside what you do, or outside what you do well, bring someone in rather than muscling through: handing it to the right colleague is faster and more accurate than learning it on the spot.',
          'Choose between @ and a group by whether the result has to come back to you: handing the whole thing over, with them dealing with the user afterwards, is an @-mention; needing their result to continue, or needing several people to deliver at all, is create_group.',
          'You do not need to ask before opening a group. Once it exists, say in one line who is in it and which part each has. summary states what this is and what counts as finished, so the members know how to fit together.',
        ],
        parameters: Type.Object({
          title: Type.String({ description: 'the group name, like "Seattle trip"' }),
          members: Type.Array(Type.String(), { description: 'member bots by name or id (you do not need to list yourself; you are added)', minItems: 1 }),
          lead: Type.Optional(Type.String({ description: 'the lead bot by name or id; you by default' })),
          summary: Type.Optional(Type.String({ description: 'one line describing what this is' })),
          task: Type.Optional(Type.String({ description: 'a task to drop in; without it, the group is simply opened' })),
        }),
        executionMode: 'sequential',
        async execute(_id, p) {
          const members = p.members.map((m) => findBot(m)).filter((b): b is Bot => !!b);
          const missing = p.members.filter((m) => !findBot(m));
          if (!members.length) throw new Error(`no such bots: ${missing.join(', ')}. configure(target=bot, action=get) lists them.`);
          const lead = (p.lead ? findBot(p.lead) : undefined) ?? c.bot();
          const ids = Array.from(new Set([lead.id, c.botId, ...members.map((b) => b.id)]));
          const matter = await ops().createGroup({ title: p.title, summary: p.summary, memberIds: ids.filter((x) => x !== lead.id), leadId: lead.id, task: p.task, byBotId: c.botId });
          return {
            content: [{ type: 'text', text: `Group "${matter.title}" created (id ${matter.id}), members: ${ids.map((x) => c.store.bot(x)?.name).join(', ')}, lead: ${lead.name}.${p.task ? ' The task is in the group.' : ''}${missing.length ? ` Not found: ${missing.join(', ')}.` : ''}` }],
            details: { matterId: matter.id },
          };
        },
      });

      pi.registerTool({
        name: 'configure',
        label: 'Change settings',
        description:
          'Read or change product-level settings — the things around a bot rather than the bot itself. target=bot: autonomy (tell|prepare|do), notify (the user\'s mute switch; when to reach out is your judgement, not this setting), pinned, avatar (value=regen to redraw, reset for the default, a sentence describing a look, or the absolute path of a png/jpg you generated). target=matter: title / summary / members (add|remove a bot) / lead / notify / pinned. target=profile: get reads the shared memory (changes go through remember). action=get without a field returns everything; without an id it lists everything.\nNot here: anything about yourself — name, tagline, character, remit and way of working, skills, recurring tasks, external tools, services, agents, messengers, asset packs — all of that is build; memory about the user is remember.',
        promptSnippet: 'product settings: notifications, pinning, autonomy, groups, connections (the bot itself is build; memory is remember)',
        promptGuidelines: [
          'When the user wants a product setting changed (notifications, pinning, autonomy, group members, a group name), change it with configure and confirm in one line — never merely agree to it. Who you are, what you can do and what you can reach is build; memory about the user is remember.',
          'Before changing another bot, configure(action=get) to see where it stands. Anything that removes something goes through ask_user first.',
          'When the user wants a messenger, an external tool or an agent connected, connect it yourself with build(aspect=channel/mcp/agent, action=add). Never send them to a config file.',
        ],
        parameters: ConfigureParams,
        executionMode: 'sequential',
        async execute(_id, p) {
          const ok = (text: string, details: Record<string, unknown> = {}) => ({ content: [{ type: 'text' as const, text }], details });
          const val = p.value as unknown;
          const str = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

          if (p.target === 'profile') {
            const doc = everos.profileDoc();
            const lines = [...(doc?.explicit ?? []).map((e) => e.description), ...(doc?.traits ?? []).map((e) => `(inferred) ${e.description}`)];
            if (p.action === 'get') return ok(lines.length ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : '(nothing has settled into a profile yet)');
            throw new Error('the profile is synthesised by the engine from conversation, so configure only reads it; to record a fact, use remember');
          }

          if (p.target === 'matter') {
            const m = findMatter(p.id);
            if (p.action === 'get' && !m) return ok(c.store.data.matters.map((x) => `- [${x.id}] ${x.title}: ${[x.ownerBotId, ...x.participantBotIds].map((b) => c.store.bot(b)?.name).join(', ')}`).join('\n') || '(no groups)');
            if (!m) throw new Error('no such group');
            if (p.action === 'get') return ok(`id: ${m.id}\nname: ${m.title}\ndescription: ${m.summary}\nlead: ${c.store.bot(m.ownerBotId)?.name}\nmembers: ${m.participantBotIds.map((b) => c.store.bot(b)?.name).join(', ')}\nnotify: ${m.notify}; pinned: ${m.pinned}`);
            const f = p.field ?? '';
            if (f === 'members') {
              const b = findBot(str(val));
              if (!b) throw new Error('no such bot');
              const next = p.action === 'remove' ? m.participantBotIds.filter((x) => x !== b.id) : Array.from(new Set([...m.participantBotIds, b.id]));
              c.store.patchMatter(m.id, { participantBotIds: next.filter((x) => x !== m.ownerBotId) });
              return ok(`${b.name} was ${p.action === 'remove' ? 'removed from' : 'added to'} the group "${m.title}".`);
            }
            if (f === 'lead') {
              const b = findBot(str(val));
              if (!b) throw new Error('no such bot');
              c.store.patchMatter(m.id, { ownerBotId: b.id, participantBotIds: Array.from(new Set([m.ownerBotId, ...m.participantBotIds])).filter((x) => x !== b.id) });
              return ok(`${b.name} now leads "${m.title}".`);
            }
            if (['title', 'summary', 'notify', 'pinned'].includes(f)) {
              c.store.patchMatter(m.id, { [f]: f === 'notify' || f === 'pinned' ? val === true || val === 'true' : str(val) } as Partial<Matter>);
              return ok(`${f} updated for the group "${m.title}".`);
            }
            throw new Error(`a matter has no field ${f}`);
          }

          // target === 'bot'
          const b = findBot(p.id);
          if (p.action === 'get' && !b) return ok(c.store.data.bots.map((x) => `- [${x.id}] ${x.name}：${x.tagline}`).join('\n'));
          if (!b) throw new Error('no such bot');
          if (p.action === 'get') return ok(describeBot(b));
          const f = p.field ?? '';
          const patch: Partial<Bot> = {};
          switch (f) {
            case 'name':
            case 'role':
            case 'soul':
            case 'tagline':
            case 'skills':
            case 'routines':
              throw new Error(`${f} belongs to the bot itself; change it with build (set writes it verbatim, rewrite has it rewrite itself)`);
            case 'autonomy':
              if (!['tell', 'prepare', 'do'].includes(str(val))) throw new Error('autonomy has to be tell, prepare or do');
              patch.autonomy = str(val) as Bot['autonomy'];
              break;
            case 'notify':
            case 'pinned':
              patch[f] = val === true || val === 'true';
              break;
            case 'avatar': {
              const msg = await ops().avatar(b.id, str(val));
              c.events.emit('crew:bot-configured', { botId: b.id, fields: ['avatar'] });
              return ok(msg, { botId: b.id, avatar: str(val) });
            }
            default:
              throw new Error(`a bot has no field "${f}"`);
          }
          c.store.patchBot(b.id, patch);
          c.events.emit('crew:bot-configured', { botId: b.id, fields: Object.keys(patch) });
          return ok(`Updated ${f} for ${b.name}.\n\n${describeBot(c.store.bot(b.id)!)}`, { botId: b.id, patch });
        },
      });
    },
  };
}
