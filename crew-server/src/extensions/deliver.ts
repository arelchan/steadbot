import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, normalize, extname } from 'node:path';
import type { BotCtx } from './ctx.ts';
import { config } from '../config.ts';
import { fileRefFor, fileRoots } from '../util.ts';
import { IM_NAME } from '../channels.ts';
import type { FileRef } from '../types.ts';

const Params = Type.Object({
  paths: Type.Array(Type.String(), {
    minItems: 1,
    maxItems: 12,
    description: '要交给用户的文件。写目录也行，系统从里面挑；工作区里的相对路径或绝对路径都认',
  }),
  what: Type.Optional(Type.String({ description: '一句话说明这是什么，用户会看到' })),
});

/** 交付物里先出手的那几类：能直接看的排前面，素材排后面。 */
const RANK = ['.html', '.pdf', '.pptx', '.docx', '.xlsx', '.md', '.csv', '.png', '.jpg', '.jpeg'];
const rankOf = (p: string) => {
  const i = RANK.indexOf(extname(p).toLowerCase());
  return i < 0 ? RANK.length : i;
};

/** 目录里的文件（只看一层，够用了：交付物的入口都在顶层）。 */
function filesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .map((n) => join(dir, n))
      .filter((p) => {
        try {
          return statSync(p).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * 交付：把做出来的东西真的递到用户手上。
 *
 * 存在的理由是「产物在哪台机器上」和「用户在哪」经常不是一回事。bot 跑在云机器上，它起的
 * localhost:8899 用户永远打不开；它写在回复里的路径也只是它自己的路径。这个工具把文件变成用户那边
 * 能点开的卡片，并且如实告诉模型这一轮的渠道到底收得到什么——IM 上现在收不到文件，那就得换个说法，
 * 而不是让用户对着一个打不开的链接。
 */
export function deliverExtension(c: BotCtx): InlineExtension {
  return {
    name: 'crew-deliver',
    factory: (pi) => {
      pi.registerTool({
        name: 'deliver',
        label: '交付',
        description:
          '把你做好的东西交给用户：给文件路径（目录也行），用户那边就会出现能点开的卡片。做完东西就用它交付，不要只在回复里写路径或链接——那是你这台机器上的路径，用户点不到。',
        promptSnippet: '把做好的文件交给用户（出卡片，能点开）',
        promptGuidelines: [
          '产出了文件就 deliver 一次：网页、PPT、报告、图、表格、脚本都算。回复里照常说清这是什么，但「拿到东西」这件事由 deliver 完成。',
          '**不要把 localhost / 127.0.0.1 的链接给用户**——那是你运行的这台机器上的地址，用户的浏览器打不开。要给他看网页，deliver 那个 .html 文件。',
          '一次把该给的都给全（入口文件 + 用户要改要用的那些），别一个文件一条消息。纯素材（十几张中间图）不用全给，给成品。',
          '工具会告诉你这一轮的渠道能不能收到文件。收不到的时候别硬说「发你了」，按它说的换个说法。',
        ],
        parameters: Params,
        async execute(_id, p) {
          const botDir = join(config.botsDir, c.botId);
          const roots = fileRoots(p.paths.join(' '), botDir);
          const picked: string[] = [];
          const missing: string[] = [];
          let trimmed = 0;
          for (const raw of p.paths) {
            const one = raw.replace(/^~\//, `${process.env.HOME ?? ''}/`).trim();
            const abs = isAbsolute(one) ? normalize(one) : (roots.map((d) => normalize(join(d, one.replace(/^\.\//, '')))).find((x) => existsSync(x)) ?? '');
            if (!abs) {
              missing.push(raw);
              continue;
            }
            let st;
            try {
              st = statSync(abs);
            } catch {
              missing.push(raw);
              continue;
            }
            if (st.isDirectory()) {
              // 目录里只挑能打开的那几类：css、js、中间产物是管道，不是交付物。一个都没有才退回全给。
              const inside = filesIn(abs);
              const openable = inside.filter((f) => rankOf(f) < RANK.length);
              const use = openable.length ? openable : inside;
              picked.push(...use.slice(0, 8));
              trimmed += Math.max(0, use.length - 8);
            } else picked.push(abs);
          }
          const files: FileRef[] = [];
          for (const abs of picked) {
            if (files.length >= 8) {
              trimmed++;
              continue;
            }
            const ref = fileRefFor(abs, botDir, c.botId);
            if (ref && !files.some((f) => f.path === ref.path)) files.push(ref);
          }
          if (!files.length) throw new Error(`这些路径下没有能交付的文件：${(missing.length ? missing : p.paths).join('、')}。先确认文件真的写出来了，路径按工作区来写。`);

          const cur = c.current();
          if (cur) cur.files = [...(cur.files ?? []), ...files.filter((f) => !(cur.files ?? []).some((x) => x.path === f.path))];

          const names = files.map((f) => f.name).join('、');
          const via = cur?.via;
          const im = via && via !== 'app' ? (IM_NAME[via] ?? via) : undefined;
          const where = im
            ? `这一轮是从${im}来的，那边现在收不到文件：卡片只在 App 里。回复里说清这是什么、让他在 App 里拿。`
            : '用户在 App 里会看到卡片，点开就能看。';
          const notes = [
            missing.length ? `没找到：${missing.join('、')}。` : '',
            trimmed ? `还有 ${trimmed} 个没放进来（一次最多 8 个），要的话再 deliver 一次。` : '',
            config.authToken ? '记住你跑的这台机器不是用户的电脑：localhost 的链接别给他。' : '',
          ].filter(Boolean);
          return {
            content: [{ type: 'text', text: `已交付：${names}。${where}${notes.length ? ' ' + notes.join(' ') : ''}` }],
            details: { files: files.map((f) => f.path) },
          };
        },
      });
    },
  };
}
