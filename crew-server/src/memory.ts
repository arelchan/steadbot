import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewStore } from './store.ts';

/**
 * Two layers of memory, both plain text so the user can read and edit them:
 *   bots/<id>/MEMORY.md   what this bot has learned about the user (Bot.viewOfYou)
 *   shared/PROFILE.md     facts every bot may rely on (Snapshot.sharedProfile)
 * The store keeps the same lines as arrays for the UI; files are the copy bots read.
 */
export class MemoryStore {
  constructor(
    private store: CrewStore,
    private botsDir: string,
    private sharedDir: string,
  ) {}

  botDir(botId: string) {
    const d = join(this.botsDir, botId);
    mkdirSync(d, { recursive: true });
    return d;
  }

  private memoryFile(botId: string) {
    return join(this.botDir(botId), 'MEMORY.md');
  }

  readPrivate(botId: string): string[] {
    const bot = this.store.bot(botId);
    return bot?.viewOfYou ?? [];
  }

  readShared(): string[] {
    return this.store.data.sharedProfile;
  }

  remember(botId: string, line: string, scope: 'private' | 'shared') {
    const text = line.trim();
    if (!text) return;
    if (scope === 'shared') {
      if (!this.store.data.sharedProfile.includes(text)) this.store.setSharedProfile([...this.store.data.sharedProfile, text]);
    } else {
      const bot = this.store.bot(botId);
      if (bot && !bot.viewOfYou.includes(text)) this.store.patchBot(botId, { viewOfYou: [...bot.viewOfYou, text] });
    }
    this.sync(botId);
  }

  forget(botId: string, line: string, scope: 'private' | 'shared') {
    const text = line.trim();
    if (!text) return 0;
    const match = (l: string) => l === text || l.includes(text) || text.includes(l);
    let removed = 0;
    if (scope === 'shared') {
      const next = this.store.data.sharedProfile.filter((l) => !match(l));
      removed = this.store.data.sharedProfile.length - next.length;
      if (removed) this.store.setSharedProfile(next);
    } else {
      const bot = this.store.bot(botId);
      if (bot) {
        const next = bot.viewOfYou.filter((l) => !match(l));
        removed = bot.viewOfYou.length - next.length;
        if (removed) this.store.patchBot(botId, { viewOfYou: next });
      }
    }
    this.sync(botId);
    return removed;
  }

  /**
   * The user is one person, so what the bots know about him is one list (DESIGN.md §18). Whatever a bot kept to
   * itself before that was decided moves into the shared list, once, and the per-bot files go away.
   */
  fold() {
    let shared = [...this.store.data.sharedProfile];
    let moved = 0;
    for (const b of this.store.data.bots) {
      if (!b.viewOfYou.length) continue;
      for (const l of b.viewOfYou) if (!shared.includes(l)) { shared.push(l); moved += 1; }
      this.store.patchBot(b.id, { viewOfYou: [] }, { growth: false });
    }
    if (moved) this.store.setSharedProfile(shared);
    for (const b of this.store.data.bots) {
      const f = this.memoryFile(b.id);
      if (existsSync(f)) rmSync(f, { force: true });
    }
    if (moved) console.log(`[crew] 记忆：${moved} 条各 bot 私记的用户事实并进了共享事实`);
  }

  /** Replace the whole list (after a background consolidation). */
  replace(botId: string, lines: string[], scope: 'private' | 'shared') {
    const clean = Array.from(new Set(lines.map((l) => l.trim()).filter(Boolean)));
    if (scope === 'shared') this.store.setSharedProfile(clean);
    else if (this.store.bot(botId)) this.store.patchBot(botId, { viewOfYou: clean }, { growth: false });
    this.sync(botId);
  }

  /** Mirror store arrays to files (so they can be inspected or edited by hand). */
  sync(botId?: string) {
    mkdirSync(this.sharedDir, { recursive: true });
    writeFileSync(join(this.sharedDir, 'PROFILE.md'), `# 关于用户\n\n${this.readShared().map((l) => `- ${l}`).join('\n')}\n`);
    // Per-bot files only while a bot still has private lines (none after fold()); an empty file would suggest a place to write.
    const ids = botId ? [botId] : this.store.data.bots.map((b) => b.id);
    for (const id of ids) {
      const lines = this.readPrivate(id);
      if (lines.length) writeFileSync(this.memoryFile(id), `# 我对用户的认知\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
    }
  }

  /** If a file was edited by hand and is newer than the store, pull it in. */
  importEdits(botId: string) {
    const f = this.memoryFile(botId);
    if (!existsSync(f)) return;
    const lines = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim())
      .filter(Boolean);
    const bot = this.store.bot(botId);
    if (bot && JSON.stringify(lines) !== JSON.stringify(bot.viewOfYou) && lines.length) this.store.patchBot(botId, { viewOfYou: lines }, { growth: false });
  }
}
