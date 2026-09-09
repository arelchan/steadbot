import { createReadToolDefinition, type InlineExtension } from '@earendil-works/pi-coding-agent';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config, isCredentialFile } from '../config.ts';

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
            if (isCredentialFile(p)) throw new Error('这是产品的凭据文件，不给 bot 读');
            return readFile(p);
          },
          access: async (p) => {
            if (isCredentialFile(p)) throw new Error('这是产品的凭据文件，不给 bot 读');
            await access(p);
          },
        },
      });
      pi.registerTool({
        ...def,
        description:
          '读文件，带行号，大文件用 offset / limit 分段。任何路径都行：你的工作区、技能手册（available_skills 里列的 SKILL.md 和它旁边的脚本、参考文件）、共享目录、系统文件。相对路径以工作区为基准。图片也能读（直接给你看）；PDF、PPT、Word、Excel 这类要抽文字或渲染的用 see。',
        promptSnippet: '读文件（文本带行号；技能手册、脚本、工作区、任何路径）',
        promptGuidelines: ['看文本文件用 read，不用 bash cat / sed。技能手册（SKILL.md）和它引用的文件也用 read。', '大文件先 read 前 200 行看结构，再按 offset 读需要的段。'],
      });
    },
  };
}
