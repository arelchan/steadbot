import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, setSettings } from '../store';
import type { UpgradeStatus, UsageReport } from '../types';
import { httpBase, authHeaders } from '../services/runtime';
import { fetchUpgradeStatus, runUpgrade } from '../services/upgrade';
import { ACCENTS, SCALES, THEMES, getAccent, getDesktopNotify, getScale, getTheme, notifySupported, setAccent, setDesktopNotify, setScale, setTheme, type Accent, type Scale, type Theme } from '../services/theme';
import { RuntimeBody } from './RuntimeView';
import { cx } from '../utils';

type Tab = 'general' | 'cloud' | 'usage' | 'about';
const TABS: { id: Tab; title: string }[] = [
  { id: 'general', title: '外观' },
  { id: 'cloud', title: '云电脑' },
  { id: 'usage', title: '用量' },
  { id: 'about', title: '关于' },
];

/** 设置：one window for everything that is not a bot — how the app looks, where the bots live, what it costs. */
export function SettingsModal({ tab: initial = 'general', onClose }: { tab?: Tab; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>(initial);
  const up = useUpgrade();
  const stale = !!up.status && !up.status.upToDate && !up.status.blocked;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal cfg" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal aria-label="设置">
        <aside className="cfg-side">
          <div className="cfg-who">
            <div className="cfg-name">设置</div>
            <div className="cfg-tag">EverBot</div>
          </div>
          <nav className="cfg-nav">
            {TABS.map((t) => (
              <button key={t.id} className={cx('cfg-tab', tab === t.id && 'on')} onClick={() => setTab(t.id)}>
                <span>{t.title}</span>
                {t.id === 'about' && stale && <span className="up-dot" aria-label="有新版本" />}
              </button>
            ))}
          </nav>
        </aside>
        <div className="cfg-main">
          <button className="cfg-close" onClick={onClose} title="关闭（Esc）">×</button>
          <div className="cfg-content">
            {tab === 'general' && <General />}
            {tab === 'cloud' && <Cloud />}
            {tab === 'usage' && <Usage />}
            {tab === 'about' && <About up={up} />}
          </div>
        </div>
      </div>
    </div>
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

/* ---------------- 外观 ---------------- */

const LANGS: { id: 'zh' | 'en' | 'auto'; label: string; hint: string }[] = [
  { id: 'zh', label: '中文', hint: 'bot 一律用中文' },
  { id: 'en', label: 'English', hint: 'bot 一律用英文' },
  { id: 'auto', label: '跟着我', hint: '你用什么语言，它就用什么语言' },
];

function General() {
  const [theme, setT] = useState<Theme>(getTheme());
  const [accent, setA] = useState<Accent>(getAccent());
  const [scale, setS] = useState<Scale>(getScale());
  const [notify, setN] = useState(getDesktopNotify());
  const lang = useStore((s) => s.settings?.language) ?? 'zh';
  return (
    <>
      <Head title="通用" sub="语言跟着这套 bot 走；外观只影响这个浏览器" />

      <h4>语言</h4>
      <div className="seg">
        {LANGS.map((l) => (
          <button key={l.id} className={cx(lang === l.id && 'on')} onClick={() => setSettings({ language: l.id })}>
            {l.label}
          </button>
        ))}
      </div>
      <div className="cfg-note">{LANGS.find((l) => l.id === lang)?.hint}。界面本身目前只有中文。</div>

      <h4>主题</h4>
      <div className="seg">
        {THEMES.map((t) => (
          <button key={t.id} className={cx(theme === t.id && 'on')} onClick={() => { setT(t.id); setTheme(t.id); }}>
            {t.label}
          </button>
        ))}
      </div>

      <h4>强调色</h4>
      <div className="swatches">
        {ACCENTS.map((a) => (
          <button key={a.id} className={cx('swatch', accent === a.id && 'on')} onClick={() => { setA(a.id); setAccent(a.id); }} title={a.label}>
            <i style={{ background: a.swatch }} />
            <span>{a.label}</span>
          </button>
        ))}
      </div>

      <h4>界面密度</h4>
      <div className="seg">
        {SCALES.map((x) => (
          <button key={x.id} className={cx(scale === x.id && 'on')} onClick={() => { setS(x.id); setScale(x.id); }}>
            {x.label}
          </button>
        ))}
      </div>

      <h4>桌面通知</h4>
      <button className="tgl-row" onClick={() => void setDesktopNotify(!notify).then(setN)} role="switch" aria-checked={notify} disabled={!notifySupported()}>
        <span className="tgl-l">
          <span>bot 找你时弹系统通知</span>
          <span className="tgl-h">{notifySupported() ? '页面在后台也能看到；关掉就只在应用里提示' : '这个浏览器不支持'}</span>
        </span>
        <span className={cx('tgl', notify && 'on')}><i /></span>
      </button>
    </>
  );
}

/* ---------------- 云电脑 ---------------- */

/** 云电脑：where the bots live, in full — the same cards as the standalone page, no jumping out of 设置. */
function Cloud() {
  const rt = useStore((s) => s.runtime);
  return (
    <>
      <Head title="云电脑" sub="bot 在哪台机器上干活，以及它们有没有自己的电脑" />
      <div className="cloud-body">
        <RuntimeBody />
      </div>
      <div className="cfg-note">
        bot 的电脑：
        {rt?.desktops
          ? '这台机器能给。每个 bot 在自己的会话右边有一块屏幕，它上网、登录、填表你都看得见。'
          : rt?.local
            ? '你的电脑只有一块屏幕，是你的。搬到云机器后，每个 bot 会有自己的一台。'
            : (rt?.desktopsNote ?? '这台机器给不了。')}
      </div>
    </>
  );
}

/* ---------------- 用量 ---------------- */

const fmtNum = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const fmtMoney = (n: number) => (n >= 1 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : '$0');

function Usage() {
  const [report, setReport] = useState<UsageReport | undefined>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    fetch(`${httpBase || window.location.origin}/usage?days=30`, { headers: authHeaders() })
      .then((r) =>
        r.ok
          ? (r.json() as Promise<UsageReport>)
          : Promise.reject(new Error(r.status === 404 ? '跑 bot 的那台机器还是旧版本，还统计不了用量。在「关于」里升级一下就有了。' : `读不到用量（${r.status}）`)),
      )
      .then((x) => alive && setReport(x))
      .catch((e: Error) => alive && setErr(/Failed to fetch|NetworkError/.test(e.message) ? '连不上跑 bot 的那台机器。' : e.message));
    return () => {
      alive = false;
    };
  }, []);
  const max = useMemo(() => Math.max(1, ...(report?.daily ?? []).map((d) => d.cost)), [report]);
  if (err) return (<><Head title="用量" /><div className="quiet">{err}</div></>);
  if (!report) return (<><Head title="用量" /><div className="quiet">读取中…</div></>);
  const t = report.total;
  return (
    <>
      <Head title="用量" sub={`最近 ${report.days} 天，按每次模型调用累计`} />
      <div className="usage-top">
        <div className="ut-cell"><span className="ut-n">{fmtMoney(t.cost)}</span><span className="ut-l">花费</span></div>
        <div className="ut-cell"><span className="ut-n">{fmtNum(t.input + t.output)}</span><span className="ut-l">token</span></div>
        <div className="ut-cell"><span className="ut-n">{fmtNum(t.calls)}</span><span className="ut-l">次调用</span></div>
      </div>
      {t.calls === 0 && <div className="quiet">这段时间还没有调用记录。</div>}
      {report.daily.length > 1 && (
        <>
          <h4>每天</h4>
          <div className="spark">
            {report.daily.map((d) => (
              <span key={d.day} className="spark-b" title={`${d.day} · ${fmtMoney(d.cost)} · ${fmtNum(d.calls)} 次`}>
                <i style={{ height: `${Math.max(3, (d.cost / max) * 100)}%` }} />
              </span>
            ))}
          </div>
          <div className="spark-x"><span>{report.daily[0]?.day.slice(5)}</span><span>{report.daily.at(-1)?.day.slice(5)}</span></div>
        </>
      )}
      {report.bots.length > 0 && (
        <>
          <h4>按 bot</h4>
          <ul className="usage-list">
            {report.bots.map((b) => (
              <li key={b.botId}>
                <span className="ul-n">{b.name}</span>
                <span className="ul-v">{fmtNum(b.input + b.output)} token · {fmtNum(b.calls)} 次</span>
                <span className="ul-c">{fmtMoney(b.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {report.models.length > 0 && (
        <>
          <h4>按模型</h4>
          <ul className="usage-list">
            {report.models.map((m) => (
              <li key={m.model}>
                <span className="ul-n mono">{m.model}</span>
                <span className="ul-v">{fmtNum(m.input + m.output)} token</span>
                <span className="ul-c">{fmtMoney(m.cost)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="cfg-note">花费按模型的单价估算，和账单可能有出入。缓存命中的 token 不计费，也没算进来。</div>
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
      setDone(r.restarting ? '升级完成，正在重启；几秒后自动连回来。' : '升级完成。');
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
  const rt = useStore((s) => s.runtime);
  const s = up.status;
  const stale = !!s && !s.upToDate && !s.blocked;
  return (
    <>
      <Head title="关于" />
      <div className="about-top">
        <div className="about-mark">🤖</div>
        <div>
          <div className="about-n">EverBot</div>
          <div className="about-v">{s ? `版本 ${s.version} · ${s.running?.slice(0, 8) ?? '未知'}` : rt?.version ? `版本 ${rt.version}` : ''}</div>
          {s && <div className="about-v">{s.repo} · {s.branch}</div>}
        </div>
      </div>
      <p className="about-p">一支替你干活的 bot 团队。你交代一句，它们自己去做，做完或者卡住才回来找你。</p>

      <h4>版本</h4>
      {!s && <div className="quiet">连不上这台电脑上的 EverBot，看不了版本。升级要从你自己的电脑上做。</div>}
      {s && (
        <div className={cx('up-card', stale && 'stale')}>
          <div className="up-main">
            <div className="up-t">
              {s.blocked ? '暂时不能升级' : stale ? '有新版本' : !s.latest ? '看不到仓库' : '已经是最新的'}
              {stale && <span className="chip cn-chip">新</span>}
            </div>
            <div className="up-s">
              {s.blocked
                ? s.blocked
                : !s.latest
                  ? '连不上 GitHub，暂时不知道有没有新版本。'
                  : stale
                    ? s.target === 'machine'
                      ? `仓库上有更新的版本。${s.machineName ? `「${s.machineName}」` : '那台机器'}会自己从 GitHub 拉下来；只是代码变了就重启几秒，依赖变了才重建镜像。`
                      : '仓库上有更新的版本。升级会拉下来并重启一下，几秒钟。'
                    : `跑的就是仓库上最新的（${s.running?.slice(0, 8) ?? '?'}）。`}
            </div>
          </div>
          {stale && !up.busy && (
            <button className="btn primary" onClick={up.start}>
              升级
            </button>
          )}
          {up.busy && <span className="quiet">升级中…</span>}
        </div>
      )}
      {up.err && <div className="up-err">{up.err}</div>}
      {up.done && <div className="up-ok">{up.done}</div>}
      {up.log.length > 0 && (
        <pre className="up-log">
          {up.log.slice(-40).join('\n')}
        </pre>
      )}

      <h4>这台运行机器</h4>
      <ul className="about-facts">
        <li><span>位置</span><b>{rt?.local ? '这台电脑' : (rt?.hostname ?? '云机器')}</b></li>
        <li><span>系统</span><b>{rt?.platform ?? '—'}</b></li>
        <li><span>状态</span><b>{rt?.mode === 'active' ? '在跑 bot' : rt?.mode === 'moved' ? '已搬走，只是路牌' : '待命'}</b></li>
        <li><span>bot 的电脑</span><b>{rt?.desktops ? '可用' : '不可用'}</b></li>
        <li><span>数据目录</span><b className="mono">{rt?.home ?? '—'}</b></li>
        {s?.latest && <li><span>仓库最新</span><b className="mono">{s.latest.slice(0, 8)}</b></li>}
        {s?.dirty && <li><span>本地改动</span><b>有没提交的改动</b></li>}
      </ul>
    </>
  );
}
