import { readFileConfig } from './config.ts';
import type { CrewStore } from './store.ts';

/*
 * What a bot must never say out loud: every credential the product holds. Model keys, each bot's IM accounts, the
 * environment of every connection. A bot does not see these on purpose (credential files are denied to read/see,
 * cards write straight into config), but it can still meet one — on a web page it is driving, in a user's paste —
 * so anything it is about to say is scrubbed against the list. The list is rebuilt lazily, a few seconds apart.
 */

const MIN_LEN = 8;
const TTL = 5_000;
let cache: { at: number; values: string[] } | undefined;

function collect(store: CrewStore): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.trim().length >= MIN_LEN) out.add(v.trim());
  };
  const file = readFileConfig() as Record<string, unknown>;
  for (const v of Object.values(file.keys ?? {})) add(v);
  add(file.authToken);
  add(file.composioApiKey);
  for (const [k, v] of Object.entries(file)) if (/secret|token|key|password/i.test(k)) add(v);
  const accounts = (file.imAccounts ?? {}) as Record<string, Record<string, Record<string, string>>>;
  for (const perBot of Object.values(accounts)) for (const acc of Object.values(perBot ?? {})) for (const v of Object.values(acc ?? {})) add(v);
  const machine = file.machine as { password?: string; token?: string } | undefined;
  add(machine?.password);
  add(machine?.token);
  for (const i of store.data.integrations) for (const v of Object.values(i.env ?? {})) add(v);
  // Longest first, so a value that contains another is replaced whole.
  return [...out].sort((a, b) => b.length - a.length);
}

export function knownSecrets(store: CrewStore): string[] {
  if (!cache || Date.now() - cache.at > TTL) cache = { at: Date.now(), values: collect(store) };
  return cache.values;
}

/** Forget the cached list (a credential was just written; the next message must not carry it). */
export function secretsChanged() {
  cache = undefined;
}

/** The text with every known credential value replaced by ••••. Returns the same string when nothing matched. */
export function redactSecrets(text: string, store: CrewStore): string {
  if (!text) return text;
  let out = text;
  for (const v of knownSecrets(store)) if (out.includes(v)) out = out.split(v).join('••••');
  return out;
}

/** Whether the text carries any known credential value. */
export function hasSecret(text: string, store: CrewStore): boolean {
  return knownSecrets(store).some((v) => text.includes(v));
}
