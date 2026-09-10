import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CrewStore } from './store.ts';

/**
 * What memory used to be: two plain-text lists, `bots/<id>/MEMORY.md` per bot and `shared/PROFILE.md` for
 * everyone, kept in the store as `viewOfYou` and `sharedProfile`. Memory now lives in the engine
 * (everos.ts); this hands whatever those lists still hold to it, once, and removes the files.
 */
export class MemoryStore {
  constructor(
    private store: CrewStore,
    private botsDir: string,
    private sharedDir: string,
  ) {}

  /** Every line the old lists still hold, cleared as it is taken. Empty on every start after the first. */
  drain(): string[] {
    const lines = new Set<string>();
    for (const l of this.store.data.sharedProfile) if (l.trim()) lines.add(l.trim());
    for (const b of this.store.data.bots) {
      for (const l of b.viewOfYou) if (l.trim()) lines.add(l.trim());
      if (b.viewOfYou.length) this.store.patchBot(b.id, { viewOfYou: [] }, { growth: false });
      const f = join(this.botsDir, b.id, 'MEMORY.md');
      if (existsSync(f)) rmSync(f, { force: true });
    }
    if (this.store.data.sharedProfile.length) this.store.setSharedProfile([]);
    const p = join(this.sharedDir, 'PROFILE.md');
    if (existsSync(p)) rmSync(p, { force: true });
    if (existsSync(this.sharedDir) && !readdirSync(this.sharedDir).length) rmSync(this.sharedDir, { recursive: true, force: true });
    return [...lines];
  }
}
