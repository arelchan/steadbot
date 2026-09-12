import { createPortal } from 'react-dom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, setSettings } from '../store';
import type { UpgradeStatus, UsageReport } from '../types';
import { httpBase, authHeaders } from '../services/runtime';
import { fetchUpgradeStatus, runUpgrade } from '../services/upgrade';
import { ACCENTS, SCALES, THEMES, getAccent, getDesktopNotify, getScale, getTheme, notifySupported, setAccent, setDesktopNotify, setScale, setTheme, type Accent, type Scale, type Theme } from '../services/theme';
import { RuntimeBody } from './RuntimeView';
import { ModelsTab } from './ModelsTab';
import { Row, Pick } from './Field';
import { cx } from '../utils';
import { LOCALES, useT, useLocale, setLocale, intlLocale, tn, t as tr, type Locale } from '../i18n';

type Tab = 'general' | 'models' | 'cloud' | 'usage' | 'about';
const TABS: { id: Tab; key: string }[] = [
  { id: 'general', key: 'set.general' },
  { id: 'models', key: 'set.models' },
  { id: 'cloud', key: 'set.cloud' },
  { id: 'usage', key: 'set.usage' },
  { id: 'about', key: 'set.about' },
];

/** 设置：one window for everything that is not a bot — how the app looks, where the bots live, what it costs. */
export function SettingsModal({ tab: initial = 'general', onClose }: { tab?: Tab; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>(initial);
  const up = useUpgrade();
  const stale = !!up.status && !up.status.upToDate && !up.status.blocked;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="overlay" onClick={onClose}>
      <div className="modal cfg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label={t('set.title')}>
        <aside className="cfg-side">
          <div className="cfg-who">
            <div className="cfg-name">{t('set.title')}</div>
          </div>
          <nav className="cfg-nav">
            {TABS.map((x) => (
              <button key={x.id} className={cx('cfg-tab', tab === x.id && 'on')} onClick={() => setTab(x.id)}>
                <span>{t(x.key)}</span>
                {x.id === 'about' && stale && <span className="up-dot" aria-label={t('set.hasNew')} />}
              </button>
            ))}
          </nav>
        </aside>
        <div className="cfg-main">
          <button className="cfg-close" onClick={onClose} title={t('common.closeEsc')}>×</button>
          <div className="cfg-content">
            {tab === 'general' && <General />}
            {tab === 'models' && (
              <>
                <Head title={t('set.models')} sub={t('models.sub')} />
                <ModelsTab />
              </>
            )}
            {tab === 'cloud' && <Cloud />}
            {tab === 'usage' && <Usage />}
            {tab === 'about' && <About up={up} />}
          </div>
        </div>
      </div>
    </div>
    ,
    document.body,
  );
}

function Head({ title, sub }: { title: string; sub?: string }) {
  return (
    <header className="cfg-head">
      <div>
        <h3>{title}</h3>
        {sub && <div className="cfg-sub">{sub}</div>}
      </div>
    </header>
  );
}

/* ---------------- 通用 ---------------- */

function General() {
  const t = useT();
  const locale = useLocale();
  const [theme, setT] = useState<Theme>(getTheme());
  const [accent, setA] = useState<Accent>(getAccent());
  const [scale, setS] = useState<Scale>(getScale());
  const [notify, setN] = useState(getDesktopNotify());
  // The interface's language, and only that: bots answer in whatever language they are spoken to.
  const pickLocale = (l: Locale) => setLocale(l);
  return (
    <>
      <Head title={t('set.general')} />
      <div className="set-rows">
        <Row label={t('set.language')}>
          <Pick value={locale} onChange={(v) => pickLocale(v as Locale)}>
            {LOCALES.map((l) => (
              <option key={l.id} value={l.id}>{l.label}</option>
            ))}
          </Pick>
        </Row>

        <TimezoneRow />

        <Row label={t('set.theme')}>
          <div className="seg tight">
            {THEMES.map((x) => (
              <button key={x.id} className={cx(theme === x.id && 'on')} onClick={() => { setT(x.id); setTheme(x.id); }}>{t(`theme.${x.id}`)}</button>
            ))}
          </div>
        </Row>

        <Row label={t('set.accent')}>
          <div className="dots">
            {ACCENTS.map((a) => (
              <button key={a.id} className={cx('dot', accent === a.id && 'on')} style={{ background: a.swatch }} onClick={() => { setA(a.id); setAccent(a.id); }} title={t(`accent.${a.id}`)} aria-label={t(`accent.${a.id}`)} />
            ))}
          </div>
        </Row>

        <Row label={t('set.density')}>
          <div className="seg tight">
            {SCALES.map((x) => (
              <button key={x.id} className={cx(scale === x.id && 'on')} onClick={() => { setS(x.id); setScale(x.id); }}>{t(`scale.${x.id}`)}</button>
            ))}
          </div>
        </Row>

        <Row label={t('set.notifySwitch')} note={notifySupported() ? undefined : t('set.notifyUnsupported')}>
          <button className={cx('tgl', notify && 'on')} onClick={() => void setDesktopNotify(!notify).then(setN)} role="switch" aria-checked={notify} disabled={!notifySupported()}><i /></button>
        </Row>
      </div>
    </>
  );
}

/* ---------------- 时区 ---------------- */

/** Minutes east of UTC for a zone right now (so the list is ordered the way every other time-zone picker is). */
function offsetMinutes(tz: string, at: Date): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(at);
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value ?? 0);
    const asUtc = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second'));
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

const offsetLabel = (min: number) => {
  const sign = min < 0 ? '-' : '+';
  const a = Math.abs(min);
  return `UTC${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

/** The zone's own name in the current language ("中国标准时间", "China Standard Time"); empty when Intl only offers GMT+8. */
function zoneName(tz: string, at: Date): string {
  try {
    const v = new Intl.DateTimeFormat(intlLocale(), { timeZone: tz, timeZoneName: 'long' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
    return /^(GMT|UTC)/i.test(v) ? '' : v;
  } catch {
    return '';
  }
}

const cityOf = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
const areaOf = (tz: string) => (tz.includes('/') ? tz.split('/')[0] : 'UTC');

/** Every IANA zone the browser knows, so someone travelling or working across zones can just pick theirs. */
const ALL_ZONES: string[] = (() => {
  const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
  const list = sv ? sv('timeZone') : [];
  return list.length ? list : ['UTC', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles'];
})();

type ZoneRow = { id: string; label: string; area: string; offset: number };
const zoneCache = new Map<string, ZoneRow[]>();

/** Built once per language: 400-odd zones, each with its offset and its name, grouped by region and ordered by offset. */
function zoneRows(locale: string, extra?: string): ZoneRow[] {
  const key = `${locale}|${extra ?? ''}`;
  const hit = zoneCache.get(key);
  if (hit) return hit;
  const at = new Date();
  const ids = extra && !ALL_ZONES.includes(extra) ? [extra, ...ALL_ZONES] : ALL_ZONES;
  const rows = ids
    .map((id) => {
      const offset = offsetMinutes(id, at);
      const name = zoneName(id, at);
      return { id, area: areaOf(id), offset, label: `(${offsetLabel(offset)}) ${cityOf(id)}${name ? ` · ${name}` : ''}` };
    })
    .sort((a, b) => a.area.localeCompare(b.area) || a.offset - b.offset || a.id.localeCompare(b.id));
  zoneCache.set(key, rows);
  return rows;
}

/** 例行任务按这个时区算时间；跑 bot 的机器多半在 UTC 上，所以这条必须跟着用户走。 */
function TimezoneRow() {
  const t = useT();
  const locale = useLocale();
  const tz = useStore((s) => s.settings?.timezone);
  const here = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = tz ?? here;
  const groups = useMemo(() => {
    const rows = zoneRows(locale, current);
    const out: { area: string; items: ZoneRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.area === r.area) last.items.push(r);
      else out.push({ area: r.area, items: [r] });
    }
    return out;
  }, [locale, current]);
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 20_000);
    return () => clearInterval(timer);
  }, []);
  const now = (() => {
    try {
      return new Date().toLocaleString(intlLocale(), { timeZone: current, hour: '2-digit', minute: '2-digit', weekday: 'short' });
    } catch {
      return '';
    }
  })();
  return (
    <Row
      label={t('set.timezone')}
      note={
        <>
          {now}
          {current !== here && (
            <>
              {' · '}
              <button className="link" onClick={() => setSettings({ timezone: here })}>{t('set.useThisDevice', { tz: here })}</button>
            </>
          )}
        </>
      }
    >
      <Pick wide value={current} onChange={(v) => setSettings({ timezone: v })}>
        {groups.map((g) => (
          <optgroup key={g.area} label={g.area}>
            {g.items.map((z) => (
              <option key={z.id} value={z.id}>{z.label}</option>
            ))}
          </optgroup>
        ))}
      </Pick>
    </Row>
  );
}

/* ---------------- 云电脑 ---------------- */

/** 云电脑：where the bots live, in full — the same cards as the standalone page, no jumping out of 设置. */
function Cloud() {
  const t = useT();
  return (
    <>
      <Head title={t('set.cloud')} />
      <div className="cloud-body">
        <RuntimeBody />
      </div>
    </>
  );
}

/* ---------------- 用量 ---------------- */

const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const fmtMoney = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0');

function Usage() {
  const t = useT();
  const [report, setReport] = useState<UsageReport | undefined>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    fetch(`${httpBase || window.location.origin}/usage?days=30`, { headers: authHeaders() })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<UsageReport>)
          : Promise.reject(new Error(r.status === 404 ? t('usage.oldVersion') : t('usage.readFail', { code: r.status }))),
      )
      .then((x) => alive && setReport(x))
      .catch((e: Error) => alive && setErr(/Failed to fetch|NetworkError/.test(e.message) ? t('usage.offline') : e.message));
    return () => {
      alive = false;
    };
  }, []);
  const max = useMemo(() => Math.max(1, ...(report?.daily ?? []).map((d) => d.cost)), [report]);
  if (err) return (<><Head title={t('set.usage')} /><div className="quiet">{err}</div></>);
  if (!report) return (<><Head title={t('set.usage')} /><div className="quiet">{t('common.loading')}</div></>);
  const total = report.total;
  return (
    <>
      <Head title={t('set.usage')} />
      <div className="usage-top">
        <div className="ut-cell"><span className="ut-n">{fmtMoney(total.cost)}</span><span className="ut-l">{t('usage.cost')}</span></div>
        <div className="ut-cell"><span className="ut-n">{fmtNum(total.input + total.output)}</span><span className="ut-l">{t('usage.tokens')}</span></div>
        <div className="ut-cell"><span className="ut-n">{fmtNum(total.calls)}</span><span className="ut-l">{t('usage.calls')}</span></div>
      </div>
      {total.calls === 0 && <div className="quiet">{t('usage.none')}</div>}
      {report.daily.length > 1 && (
        <>
          <h4>{t('usage.daily')}</h4>
          <div className="spark">
            {report.daily.map((d) => (
              <span key={d.day} className="spark-b" title={`${d.day} · ${fmtMoney(d.cost)} · ${tn('usage.callsN', d.calls)}`}>
                <i style={{ height: `${Math.max(3, (d.cost / max) * 100)}%` }} />
              </span>
            ))}
          </div>
          <div className="spark-x"><span>{report.daily[0]?.day.slice(5)}</span><span>{report.daily.at(-1)?.day.slice(5)}</span></div>
        </>
      )}
      {!!report.kinds?.length && (
        <>
          <h4>{t('usage.byKind')}</h4>
          <ul className="usage-list">
            {report.kinds.map((k) => (
              <li key={k.kind}>
                <span className="ul-n">{t(`usage.kind.${k.kind}`)}</span>
                <span className="ul-v">{tn('usage.callsN', k.calls)}</span>
                <span className="ul-c">{fmtMoney(k.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.bots.length > 0 && (
        <>
          <h4>{t('usage.byBot')}</h4>
          <ul className="usage-list">
            {report.bots.map((b) => (
              <li key={b.botId}>
                <span className="ul-n">{b.name}</span>
                <span className="ul-v">{fmtNum(b.input + b.output)} {t('usage.tokens')} · {tn('usage.callsN', b.calls)}</span>
                <span className="ul-c">{fmtMoney(b.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.models.length > 0 && (
        <>
          <h4>{t('usage.byModel')}</h4>
          <ul className="usage-list">
            {report.models.map((m) => (
              <li key={m.model}>
                <span className="ul-n mono">{m.model}</span>
                <span className="ul-v">{fmtNum(m.input + m.output)} {t('usage.tokens')}</span>
                <span className="ul-c">{fmtMoney(m.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/* ---------------- 关于 + 升级 ---------------- */

/** Polls the local EverBot: it holds the code, so it is the one that knows whether there is a newer version. */
export function useUpgrade() {
  const [status, setStatus] = useState<UpgradeStatus | undefined>();
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const refresh = () => void fetchUpgradeStatus().then((s) => s && setStatus(s));
  useEffect(() => {
    refresh();
    timer.current = setInterval(refresh, 60_000);
    return () => clearInterval(timer.current);
  }, []);
  const start = async () => {
    setBusy(true);
    setErr('');
    setDone('');
    setLog([]);
    try {
      const r = await runUpgrade((line) => setLog((x) => [...x.slice(-200), line]));
      setDone(r.restarting ? tr('about.upgradedRestart') : tr('about.upgraded'));
      if (r.restarting) setTimeout(() => window.location.reload(), 4000);
      else refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { status, log, busy, err, done, start, refresh };
}

function About({ up }: { up: ReturnType<typeof useUpgrade> }) {
  const t = useT();
  const rt = useStore((s) => s.runtime);
  const s = up.status;
  const stale = !!s && !s.upToDate && !s.blocked;
  // The version has a name (the tag it carries, or how far it is past one); the commit stays as the fine print.
  const name = s?.runningName ?? (s ? `v${s.version}` : rt?.version ? `v${rt.version}` : undefined);
  const next = s?.latestName ?? s?.latest?.slice(0, 8);
  return (
    <>
      <Head title={t('set.about')} />
      <div className="about-top">
        <div className="about-mark">🤖</div>
        <div className="about-id">
          <div className="about-n">
            EverBot
            {name && <span className="about-tag">{name}</span>}
          </div>
          <div className="about-v">
            {s?.running && <span className="mono">{s.running.slice(0, 8)}</span>}
            {s && <span>{s.repo} · {s.branch}</span>}
            {!s && <span>{t('about.noLocal')}</span>}
          </div>
        </div>
        {stale && (
          <button className="btn primary about-up" onClick={up.start} disabled={up.busy}>
            {up.busy ? t('about.upgrading') : t('about.upgradeTo', { v: next ?? '' })}
          </button>
        )}
      </div>
      {s?.blocked && <div className="about-blocked">{s.blocked}</div>}
      {up.err && <div className="up-err">{up.err}</div>}
      {up.done && <div className="up-ok">{up.done}</div>}
      {up.log.length > 0 && <pre className="up-log">{up.log.slice(-40).join('\n')}</pre>}

      <h4>{t('about.machine')}</h4>
      <ul className="about-facts">
        <li><span>{t('about.where')}</span><b>{rt?.local ? t('side.thisComputer') : (rt?.hostname ?? t('side.cloudMachine'))}</b></li>
        <li><span>{t('about.system')}</span><b>{rt?.platform ?? '—'}</b></li>
        <li><span>{t('about.state')}</span><b>{rt?.mode === 'active' ? t('about.stateActive') : rt?.mode === 'moved' ? t('about.stateMoved') : t('about.stateIdle')}</b></li>
        <li><span>{t('about.botComputer')}</span><b>{rt?.desktops ? t('about.available') : t('about.unavailable')}</b></li>
        <li><span>{t('about.dataDir')}</span><b className="mono">{rt?.home ?? '—'}</b></li>
      </ul>
    </>
  );
}
