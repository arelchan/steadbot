/**
 * AvatarService is the seam for a real image model.
 * Production: call the image model with a prompt like
 *   `Q版圆形头像，${bot.name}，职责：${bot.role}，扁平插画，暖色背景`
 * and store the returned URL on bot.avatarUrl.
 * The ProceduralAvatarService below draws a deterministic cartoon face as an SVG data URI,
 * so the UI is complete before the model is wired in.
 */
export interface AvatarService {
  generate(seed: string, hint?: string): Promise<string>;
}

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

const SKIN = ['#f6d7bd', '#f1c9a5', '#e6b58f', '#d9a077', '#c68a63', '#fbe3cf'];
const HAIR = ['#2b2320', '#4a2f24', '#6b4a35', '#8a5a3c', '#3a3f6b', '#7a3b4a', '#2f4f3f', '#a8632e', '#555a63'];
const BG = ['#f6e9e1', '#e8eef5', '#e9f1e6', '#f4ecd9', '#f0e6f2', '#e5f0ee', '#f7e6e0', '#ebeaf5'];
const CHEEK = '#f0a3a0';

export function procedural(seed: string): string {
  const h = hash(seed);
  const pick = <T,>(arr: T[], n: number) => arr[(h >>> n) % arr.length];
  const skin = pick(SKIN, 0);
  const hair = pick(HAIR, 4);
  const bg = pick(BG, 8);
  const style = (h >>> 12) % 5; // hair style
  const glasses = (h >>> 16) % 4 === 0;
  const eye = (h >>> 18) % 3; // 0 dots, 1 happy arcs, 2 wide
  const mouth = (h >>> 20) % 3;
  const acc = (h >>> 22) % 5; // 0 none 1 headband 2 earrings 3 bow 4 cap

  const hairShape = (() => {
    switch (style) {
      case 0: // bangs
        return `<path d="M22 50c0-18 12-30 30-30s30 12 30 30v6c-6-8-14-12-30-12S28 48 22 56z" fill="${hair}"/>`;
      case 1: // side part
        return `<path d="M22 52c0-20 12-32 30-32 20 0 32 12 32 32-8-10-20-12-30-8-8 3-12 8-16 8-8 0-12-4-16 0z" fill="${hair}"/>`;
      case 2: // bun
        return `<circle cx="52" cy="20" r="11" fill="${hair}"/><path d="M22 52c0-18 12-30 30-30s30 12 30 30c-8-8-18-10-30-10S30 44 22 52z" fill="${hair}"/>`;
      case 3: // long
        return `<path d="M20 78V52c0-18 12-30 32-30s32 12 32 30v26h-10V56c-6-6-14-8-22-8s-16 2-22 8v22z" fill="${hair}"/>`;
      default: // short curly
        return `<path d="M22 54c-4-16 6-34 30-34s34 18 30 34c-4-8-10-10-14-8-4-6-10-8-16-8s-12 2-16 8c-4-2-10 0-14 8z" fill="${hair}"/>`;
    }
  })();

  const eyes = (() => {
    if (eye === 1) return `<path d="M38 58q4-5 8 0M58 58q4-5 8 0" stroke="#2b2320" stroke-width="2.6" fill="none" stroke-linecap="round"/>`;
    if (eye === 2) return `<circle cx="42" cy="58" r="3.4" fill="#2b2320"/><circle cx="62" cy="58" r="3.4" fill="#2b2320"/><circle cx="43.2" cy="56.8" r="1" fill="#fff"/><circle cx="63.2" cy="56.8" r="1" fill="#fff"/>`;
    return `<circle cx="42" cy="58" r="2.6" fill="#2b2320"/><circle cx="62" cy="58" r="2.6" fill="#2b2320"/>`;
  })();

  const mouthPath = mouth === 0
    ? `<path d="M46 70q6 5 12 0" stroke="#b0564a" stroke-width="2.4" fill="none" stroke-linecap="round"/>`
    : mouth === 1
      ? `<path d="M47 69q5 8 10 0z" fill="#b0564a"/>`
      : `<path d="M48 70h8" stroke="#b0564a" stroke-width="2.4" stroke-linecap="round"/>`;

  const accessory = (() => {
    switch (acc) {
      case 1: return `<path d="M26 46q26-14 52 0" stroke="#c96f4a" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      case 2: return `<circle cx="27" cy="66" r="2.5" fill="#d8a441"/><circle cx="77" cy="66" r="2.5" fill="#d8a441"/>`;
      case 3: return `<path d="M64 26l10-6v14zM64 26l-10-6v14z" fill="#c96f4a"/><circle cx="64" cy="26" r="2.5" fill="#a8552f"/>`;
      case 4: return `<path d="M22 48c0-16 12-28 30-28s30 12 30 28H22z" fill="#4a5d8a"/><path d="M18 48h70" stroke="#4a5d8a" stroke-width="5" stroke-linecap="round"/>`;
      default: return '';
    }
  })();

  const specs = glasses ? `<circle cx="42" cy="58" r="8" stroke="#2b2320" stroke-width="1.8" fill="none"/><circle cx="62" cy="58" r="8" stroke="#2b2320" stroke-width="1.8" fill="none"/><path d="M50 58h4" stroke="#2b2320" stroke-width="1.8"/>` : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104 104">
<circle cx="52" cy="52" r="52" fill="${bg}"/>
<path d="M30 104c2-16 10-24 22-24s20 8 22 24z" fill="${hair}" opacity="0.9"/>
<rect x="45" y="72" width="14" height="14" rx="5" fill="${skin}"/>
<circle cx="52" cy="58" r="26" fill="${skin}"/>
<circle cx="26" cy="60" r="4" fill="${skin}"/><circle cx="78" cy="60" r="4" fill="${skin}"/>
${hairShape}
<circle cx="36" cy="66" r="4" fill="${CHEEK}" opacity="0.55"/><circle cx="68" cy="66" r="4" fill="${CHEEK}" opacity="0.55"/>
${eyes}${specs}${mouthPath}${accessory}
</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

export class ProceduralAvatarService implements AvatarService {
  async generate(seed: string) {
    return procedural(seed);
  }
}

export const avatarService: AvatarService = new ProceduralAvatarService();

/** Downscale an uploaded image to a small square data URL so it fits in local storage. */
export function fileToAvatar(file: File, size = 160): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d')!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = reject;
    img.src = url;
  });
}
