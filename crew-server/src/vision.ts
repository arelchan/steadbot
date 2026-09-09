/**
 * Seeing. The model a bot talks with may have no eyes (a cheap text model usually doesn't), so pictures go to a
 * vision model in a single side call and come back as words. That is the shape the industry has settled on: the
 * agent keeps its main model and delegates looking, rather than swapping models mid-conversation.
 *
 * Which model: `visionModel` from the config, else the main model when it can see, else the light model when it can.
 */
import type { Api, ImageContent, Model } from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { readFileSync } from 'node:fs';

export interface Eyes {
  runtime: ModelRuntime;
  model: Model<Api>;
}

/** The image parts of a message, straight from disk. */
export function imageContent(file: string, mime: string): ImageContent {
  return { type: 'image', data: readFileSync(file).toString('base64'), mimeType: mime.split(';')[0] };
}

/**
 * Ask the vision model about one or more pictures. `question` is what the bot wants to know; without one it gets a
 * full description, because the bot cannot come back for a second look cheaply.
 */
export async function look(eyes: Eyes, images: ImageContent[], question?: string, context?: string): Promise<string> {
  const ask = question?.trim()
    ? `${question.trim()}\n\n只回答看到的内容，不要客套，不要说「这张图片显示」。看不清就说看不清。`
    : '把图里的内容如实说清楚：整体是什么，画面里有什么，所有可读的文字原样抄出来（表格保持行列关系）。不要评价、不要客套。';
  const res = await eyes.runtime.completeSimple(eyes.model, {
    systemPrompt: '你是另一个 agent 的眼睛。它看不到图，只能读你的描述，所以要具体、完整、只讲事实。',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: context ? `${context}\n\n${ask}` : ask }, ...images],
        timestamp: Date.now(),
      },
    ],
  });
  const text = res.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('')
    .trim();
  return text || '（模型没有给出描述）';
}

/** What reads pictures when nothing is configured: cheap, fast, and on the provider the product already uses. */
export const DEFAULT_VISION_MODEL = 'openrouter/google/gemini-2.5-flash';

const sees = (m: Model<Api> | undefined) => !!m && (m.input ?? []).includes('image');

/** Resolve the eyes once: the model meant for this, else whichever of the bots' own models can see. */
export function resolveEyes(runtime: ModelRuntime | undefined, vision: Model<Api> | undefined, main: Model<Api> | undefined, light: Model<Api> | undefined): Eyes | undefined {
  if (!runtime) return undefined;
  const model = [vision, main, light].find(sees);
  return model ? { runtime, model } : undefined;
}
