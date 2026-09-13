import { getLocale, intlLocale, t, tn } from './i18n';

/** Intl formatters are expensive to build and get called per message: keep one of each per language. */
const cache = new Map<string, Intl.DateTimeFormat>();
const fmt = (opts: Intl.DateTimeFormatOptions, tag: string) => {
  const key = `${getLocale()}:${tag}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(intlLocale(), opts);
    cache.set(key, f);
  }
  return f;
};

/** Clock, in whatever shape the language uses (24-hour here, 10:10 AM in en-US). */
export const fmtTime = (ts: number) => fmt({ hour: '2-digit', minute: '2-digit' }, 'hm').format(ts);

const weekday = (ts: number) => fmt({ weekday: 'short' }, 'wd').format(ts);
const monthDay = (ts: number) => fmt({ month: 'numeric', day: 'numeric' }, 'md').format(ts);

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/** How many days ago, counting calendar days rather than 24-hour blocks. */
const daysAgo = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
};

export const dayLabel = (ts: number) => {
  const diff = daysAgo(ts);
  const tail = `${weekday(ts)} ${monthDay(ts)}`;
  if (diff === 0) return `${t('day.today')} ${tail}`;
  if (diff === 1) return `${t('day.yesterday')} ${tail}`;
  return tail;
};

/** Full date for records (withTime=false drops the clock). */
export const fullDate = (ts: number, withTime = true) => {
  const date = fmt({ year: 'numeric', month: 'long', day: 'numeric' }, 'ymd').format(ts);
  return withTime ? `${date} ${fmtTime(ts)}` : date;
};

/** Message timestamps: the clock today, 昨天 / yesterday, then the date (with the year once it differs). */
export const msgTime = (ts: number) => {
  const diff = daysAgo(ts);
  const hm = fmtTime(ts);
  if (diff === 0) return hm;
  if (diff === 1) return `${t('day.yesterday')} ${hm}`;
  if (diff === 2) return `${t('day.beforeYesterday')} ${hm}`;
  const sameYear = new Date(ts).getFullYear() === new Date().getFullYear();
  return `${sameYear ? monthDay(ts) : fmt({ year: 'numeric', month: 'numeric', day: 'numeric' }, 'ymdn').format(ts)} ${hm}`;
};

export const shortDay = (ts: number) => {
  const diff = daysAgo(ts);
  if (diff === 0) return fmtTime(ts);
  if (diff === 1) return t('day.yesterday');
  return weekday(ts);
};

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');

/** 等了多久。只给一个量级——一件事等了三小时二十分，重点是「三小时」。 */
export const waited = (ts: number) => {
  const min = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (min < 60) return tn('wait.min', min);
  const h = Math.floor(min / 60);
  if (h < 48) return tn('wait.hour', h);
  return tn('wait.day', Math.floor(h / 24));
};

/**
 * Money, as the runtime reported it. A confirmation card is a claim about a charge, so the currency has to come
 * from whoever knows the charge — never from the interface language, which would turn ¥117 into $117 for anyone
 * reading the app in English. No currency on the record means the product's historical default.
 */
export const money = (amount: number, currency?: string) => {
  if (!currency) return `¥${amount}`;
  try {
    return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
};
