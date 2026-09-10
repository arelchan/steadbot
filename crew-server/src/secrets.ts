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

/**
 * Credentials the product does not hold yet. The list above only knows what is already stored, and the leak that
 * matters happens one step earlier: a bot reads a secret off the page it is driving and says it out loud on the way
 * to storing it. These are the shapes that are never anything but a credential — plus a 32-character word standing
 * next to the word "secret", which is what a Feishu app hands out.
 */
const SHAPES: RegExp[] = [
  /\b\d{8,12}:[A-Za-z0-9_-]{35}\b/g, // telegram bot token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // slack bot / user token
  /\bxapp-[A-Za-z0-9-]{10,}/g, // slack app token
  /\bsk-[A-Za-z0-9_-]{20,}/g, // openai-style model key
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, // aws access key id
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // github token
];
/** A bare 32-character word is only a secret when the sentence says so (an md5 or a build id is not). */
const NEAR_SECRET = /((?:secret|密钥|凭据|token|app\s*secret)[^\n]{0,40}?)\b([A-Za-z0-9]{32})\b/gi;

/** The text with every credential — known value or unmistakable shape — replaced by ••••. */
export function redactSecrets(text: string, store: CrewStore): string {
  if (!text) return text;
  let out = text;
  for (const v of knownSecrets(store)) if (out.includes(v)) out = out.split(v).join('••••');
  for (const re of SHAPES) out = out.replace(re, '••••');
  out = out.replace(NEAR_SECRET, (_m, lead: string) => `${lead}••••`);
  return out;
}

/** Whether the text carries any known credential value. */
export function hasSecret(text: string, store: CrewStore): boolean {
  return knownSecrets(store).some((v) => text.includes(v));
}
