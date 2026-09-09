const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number) => String(n).padStart(2, '0');

export const fmtTime = (ts: number) => {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dayKey = (ts: number) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

export const dayLabel = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (diff === 0) return `今天 ${WEEK[d.getDay()]} ${md}`;
  if (diff === 1) return `昨天 ${WEEK[d.getDay()]} ${md}`;
  return `${WEEK[d.getDay()]} ${md}`;
};

/** Full date for records: 2026年9月7日 12:28 (withTime=false drops the clock). */
export const fullDate = (ts: number, withTime = true) => {
  const d = new Date(ts);
  const date = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  return withTime ? `${date} ${fmtTime(ts)}` : date;
};

/** Message timestamps: 10:10 today, 昨天 10:10, 前天 10:10, then 10月10日 10:10 (with the year once it differs). */
export const msgTime = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  const hm = fmtTime(ts);
  if (diff === 0) return hm;
  if (diff === 1) return `昨天 ${hm}`;
  if (diff === 2) return `前天 ${hm}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getFullYear() === today.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}年${md} ${hm}`;
};

export const shortDay = (ts: number) => {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 86400000);
  if (diff === 0) return fmtTime(ts);
  if (diff === 1) return '昨天';
  return WEEK[d.getDay()];
};

export const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ');
