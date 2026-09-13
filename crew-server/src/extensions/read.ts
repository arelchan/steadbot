import { createReadToolDefinition, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config, isCredentialFile, isMemoryFile } from '../config.ts';

/**
 * read: pi's own file reader, on for every bot. Any path goes — the workspace, a skill's SKILL.md and the scripts
 * beside it, the shared directory, a system file — because a bot that can only read its own folder cannot read the
 * manuals it was given. The one exception is the product's credential files: those hold model keys and pairing
 * tokens, and the bot is never one of their readers.
 */
export function readExtension(c: BotCtx): InlineExtension {
  const workspace = join(config.botsDir, c.botId, 'workspace');
  return {
    name: 'crew-read',
    factory: (pi) => {
      const def = createReadToolDefinition(workspace, {
        operations: {
          readFile: async (p) => {
            if (isCredentialFile(p)) throw new Error('that is the product credential file; bots do not read it');
            if (isMemoryFile(p)) throw new Error('that is the memory store; it is not read as files. Use recall, which only ever gives you your own part');
            return readFile(p);
          },
          access: async (p) => {
            if (isCredentialFile(p)) throw new Error('that is the product credential file; bots do not read it');
            if (isMemoryFile(p)) throw new Error('that is the memory store; it is not read as files. Use recall, which only ever gives you your own part');
            await access(p);
          },
        },
      });
      pi.registerTool({
        ...def,
        description:
          'Read a file with line numbers; use offset / limit for large ones. Any path works: your workspace, a manual (the SKILL.md listed in available_skills and the scripts and references beside it), shared directories, system files. Relative paths are workspace-relative. Images work too (you see them directly); anything that needs text extraction or rendering — PDF, slides, Word, Excel — goes through see.',
        promptSnippet: 'read a file (line-numbered text; manuals, scripts, workspace, any path)',
        promptGuidelines: ['Use read for text files, not bash cat / sed. Manuals (SKILL.md) and the files they reference are read the same way.', 'For a large file, read the first 200 lines for the shape, then use offset for the part you need.'],
      });
    },
  };
}
