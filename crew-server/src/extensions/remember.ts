import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { StringEnum } from '@earendil-works/pi-ai';
import { Type } from 'typebox';
import type { BotCtx } from './ctx.ts';
import * as everos from '../everos.ts';
import { botThread } from '../types.ts';
import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import { isCredentialFile, isMemoryFile } from '../config.ts';

/**
 * remember / recall: the two ends of memory.
 *
 * `remember` pins a fact by hand — it stays a plain line the user can read and edit (memory.ts), and
 * is repeated to the engine as something the user said, so the two halves of "what we know about him"
 * do not drift apart. `recall` is the bot going back through what it and the crew have actually done;
 * the turn already arrives with the relevant few (identity.ts), so this is for what that missed.
 */
export function rememberExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-remember',
    factory: (pi) => {
      pi.registerTool({
        name: 'remember',
        label: 'Memory',
        description:
          'Remember or forget a durable fact about the user: preferences, habits, constraints, what to call them, the people and places that keep coming up. action=add (the default) records one; action=forget declares one no longer true. The user is one person, so every bot reads these — there is no private copy. It goes into the memory engine as something the user said, the engine folds it into their profile, and the call returns immediately. This is for facts about the user; your own character and way of working go through build.',
        promptSnippet: 'remember or forget durable facts about the user (shared by every bot)',
        promptGuidelines: [
          'Record only what is durable and will matter later, not the details of one task. Duplicates are fine — the engine merges them.',
          'Always record what they explicitly ask you to remember, and use forget when they say not to. For a preference you inferred, say so in your reply ("noted: …") so they know it was recorded.',
          'One fact per call, written as a complete short sentence — "prefers standard class on business trips", not a fragment like "likes trains".',
        ],
        parameters: Type.Object({
          fact: Type.String({ description: 'the fact in one sentence; for forget, roughly the one to drop' }),
          action: Type.Optional(StringEnum(['add', 'forget'] as const)),
        }),
        async execute(_id, p) {
          const action = p.action ?? 'add';
          // Said to the engine as the user saying it; a "forget" is a correction, since a conversation that happened
          // is not unsaid — the engine resolves conflicts in favour of the newer statement.
          const thread = c.current()?.threadId ?? botThread(c.botId);
          void (action === 'add' ? everos.statedFact(thread, p.fact) : everos.correct(p.fact));
          return {
            content: [{ type: 'text', text: everos.alive() ? (action === 'add' ? 'Noted. Carry on.' : 'Recorded as no longer true. Carry on.') : 'The memory engine is not running, so this had nowhere to land. Carry on.' }],
            details: { action, fact: p.fact },
          };
        },
      });

      pi.registerTool({
        name: 'knowledge',
        label: 'Knowledge',
        description:
          'Search the material the user gave the team (product docs, standards, minutes, client files) — one shared copy for everyone. No arguments or a query: search topics and get names plus summaries. With topic: read that topic in full. With file (an absolute path in your workspace): file that document into the library, where every bot can find it.\nThis is what is known, not how to do something — steps to follow live in your skills, outside facts come from web_search, and what the user said or did before comes from recall.',
        promptSnippet: 'search the team library: find topics, read one in full, file a document into it',
        promptGuidelines: [
          'The three most relevant summaries are already at the top of every turn. When a summary is not enough, knowledge(topic=…) for the full text — do not guess from the summary.',
          'File a document only when the user sends one and says to go by it from now on. A file you are just looking at once goes through read / see, not into the library.',
          'When an answer comes from the library, say which document and which topic, so the user can go back and check.',
        ],
        parameters: Type.Object({
          query: Type.Optional(Type.String({ description: 'what to look for' })),
          topic: Type.Optional(Type.String({ description: 'topic id, to read it in full' })),
          file: Type.Optional(Type.String({ description: 'an absolute path in the workspace, to file that document' })),
        }),
        async execute(_id, p) {
          const text = await knowledgeTool(c, p);
          return { content: [{ type: 'text', text }], details: { ...p } };
        },
      });

      pi.registerTool({
        name: 'recall',
        label: 'Recall',
        description:
          'Go through your own memory. scope=user: what the user said or did before (for when they mention "that thing last time" and you do not know which). scope=self: work of this kind you have done and what you took from it. scope=crew: practices the team has settled on. This is remembering, not searching — outside facts, news and prices come from web_search, manuals from library. The most relevant few are already at the top of every turn; this is for what did not make it in.',
        promptSnippet: 'go through memory: the user\'s past, your own work, team practice',
        promptGuidelines: [
          'When they say "that one last time" or "same as before" and you are unsure which, recall(scope=user) before asking. If you can find it yourself, do not ask.',
          'Before taking on a kind of work, recall(scope=self) to see where you came unstuck last time. Nothing found means carry on normally — do not remark on it.',
          'Finding nothing is normal (only work that went wrong leaves a record). Do not keep rephrasing and retrying, and do not report that you searched your memory.',
        ],
        parameters: Type.Object({
          query: Type.String({ description: 'what to look for, in one line, in words that may have been used at the time' }),
          scope: StringEnum(['user', 'self', 'crew'] as const),
          k: Type.Optional(Type.Number({ description: 'how many at most; defaults to 5' })),
        }),
        async execute(_id, p) {
          const text = await everos.recall(c.botId, p.query, p.scope, p.k ?? 5);
          return { content: [{ type: 'text', text }], details: { scope: p.scope, query: p.query } };
        },
      });
    },
  };
}

/** One tool, three jobs: search the topics, read one in full, file a document into the shared library. */
async function knowledgeTool(c: BotCtx, p: { query?: string; topic?: string; file?: string }): Promise<string> {
  if (!everos.alive()) return 'The library is not running (the memory engine is down), so it cannot be searched right now.';
  if (p.file) {
    const f = p.file.trim();
    if (isCredentialFile(f) || isMemoryFile(f)) return 'That file cannot go into the library.';
    let size = 0;
    try {
      size = statSync(f).size;
    } catch {
      return `Cannot find ${f}.`;
    }
    if (size > 50 * 1024 * 1024) return 'That file is over 50 MB and cannot go into the library.';
    const name = basename(f);
    void everos
      .kAdd(name, readFileSync(f), p.query?.trim() || name.replace(/\.[a-z0-9]+$/i, ''))
      .then((r) => {
        if (r) c.store.addMessage({ threadId: c.current()?.threadId ?? botThread(c.botId), author: 'system', botId: c.botId, text: `The library took "${p.query?.trim() || name}" and split it into ${r.topics} topics.`, ts: Date.now() });
      })
      .catch(() => undefined);
    return `Reading "${name}". Splitting it into topics takes about a minute, and there will be a line in the thread when it is done. Do something else this turn.`;
  }
  if (p.topic) {
    const t = await everos.kTopic(p.topic.trim());
    if (!t) return 'No such topic; search with query first.';
    return `${t.path}\n\n${t.content ?? t.summary}`;
  }
  const q = p.query?.trim() ?? '';
  if (!q) {
    const { items } = await everos.kDocs();
    if (!items.length) return 'The library is empty.';
    return `The library holds ${items.length}:\n${items.map((d) => `- ${d.title} (${d.category}, ${d.topics} topics)`).join('\n')}`;
  }
  const hits = await everos.kSearch(q, 6);
  if (!hits.length) return 'Nothing relevant in the library.';
  return `Found ${hits.length}:\n${hits.map((h) => `- [${h.topic.id}] ${h.doc} | ${h.topic.name}: ${h.topic.summary.slice(0, 200)}`).join('\n')}\nFor detail, knowledge(topic=the id in brackets).`;
}
