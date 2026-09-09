import { select as selectThread } from '../store';
import { botThread as toBotThread } from '../types';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { RuntimeInfo } from '../types';
import { agent } from '../services/agent';
import { getRuntime, setRuntime, parsePairingCode, probeRuntime, oneShot, localWsUrl, localHttpBase, httpBase, authHeaders } from '../services/runtime';
import { ConfirmDialog } from './ConfirmDialog';
import { cloudAvailable, provisionCloudHome, cloudHomeStatus, destroyCloudHome } from '../services/cloud';
import { cx } from '../utils';
import { useT, tx, t as tr } from '../i18n';

/**
 * "Where the bots live." One page, plain words: which machine runs the bots right now, what that means,
 * and how to move them to a machine that stays on (or back). No servers, tokens or runtimes in the copy.
 */
export function RuntimeView() {
  const t = useT();
  const target = getRuntime();
  const remote = target.kind === 'remote';
  return (
    <section className="col thread">
      <header className="hd">
        <span className="rt-hd-ic">{remote ? '☁' : '⌂'}</span>
        <div className="who">
          <span className="n">{t('rt.title')}</span>
          <span className="t">{t('rt.sub')}</span>
        </div>
      </header>
      <div className="inbox rt-page">
        <RuntimeBody />
      </div>
    </section>
  );
}

/** Everything about where the bots live: the same cards whether shown as a page or inside 设置 › 云电脑. */
export function RuntimeBody() {
  const t = useT();
  const rt = useStore((s) => s.runtime);
  const online = useStore((s) => s.online);
  const target = getRuntime();
  const remote = target.kind === 'remote';
  return (
    <>
      <CurrentCard rt={rt} online={online} remote={remote} name={remote ? target.name : undefined} />
      {rt?.mode === 'active' && <MachineReadiness />}
      {rt?.mode === 'moved' && <MovedNotice rt={rt} />}
      {!remote && rt?.mode !== 'moved' && cloudAvailable && <HostedCard />}
      {!remote && rt?.mode !== 'moved' && <MoveOutCard />}
      {remote && <MoveBackCard rt={rt} />}
      {!remote && cloudAvailable && <CloudLeftover />}
      <div className="rt-fine">{t('rt.fine')}</div>
    </>
  );
}

interface ReadyRow {
  skill: string;
  requires: string[];
  ready: boolean;
  note: string;
}

/**
 * 「这台机器」: for every manual whose tools have to be installed here, whether they are. One button installs what is
 * missing; the rows are the same ones the bots read in their own skill list.
 */
function MachineReadiness() {
  const t = useT();
  const [rows, setRows] = useState<ReadyRow[] | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const base = httpBase || window.location.origin;
  const load = (method: 'GET' | 'POST') =>
    fetch(`${base}/machine/${method === 'POST' ? 'ensure' : 'readiness'}`, { method, headers: authHeaders() })
      .then((r) => (r.ok ? (r.json() as Promise<{ rows: ReadyRow[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((d) => setRows(d.rows))
      .catch(() => setRows((cur) => cur ?? []));
  useEffect(() => {
    void load('GET');
  }, [base]);
  if (!rows) return null;
  const missing = rows.filter((r) => !r.ready);
  const fill = async () => {
    setBusy(true);
    await load('POST');
    setBusy(false);
  };
  return (
    <div className="rt-card">
      <div className="rt-row">
        <div className="rt-title">{t('rt.machine')}</div>
        {missing.length > 0 && (
          <button className="btn sm" disabled={busy} onClick={() => void fill()}>
            {busy ? t('rt.filling') : t('rt.fill')}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="quiet">{t('rt.noNeeds')}</div>
      ) : (
        <ul className="rt-ready">
          {rows.map((r) => (
            <li key={r.skill} className={cx(!r.ready && 'missing')}>
              <span className="rt-ready-skill">{r.skill}</span>
              <span className="quiet rt-ready-req">{r.requires.join(' · ')}</span>
              <span className={cx('rt-ready-st', r.ready ? 'ok' : 'no')}>{r.ready ? t('rt.ready') : `${t('rt.missing')} ${r.note.replace(/^缺\s*/, '')}`}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurrentCard({ rt, online, remote, name }: { rt?: RuntimeInfo; online?: boolean; remote: boolean; name?: string }) {
  const t = useT();
  const label = remote ? name || rt?.hostname || t('rt.myServer') : t('rt.thisComputer');
  const status = online === false ? t('rt.offline') : rt ? (rt.mode === 'active' ? t('rt.online') : rt.mode === 'moved' ? t('rt.moved') : t('rt.standby')) : t('rt.connecting');
  return (
    <div className={cx('rt-card current', remote && 'remote')}>
      <div className="rt-ic">{remote ? '☁' : '⌂'}</div>
      <div className="rt-main">
        <div className="rt-title">
          {tx('rt.nowOn', { name: <b>{label}</b> })}
          <span className={cx('rt-status', online === false ? 'off' : rt?.mode === 'active' ? 'ok' : 'warn')}>{status}</span>
        </div>
        <div className="rt-desc">
          {remote ? t('rt.descRemote') : t('rt.descLocal')}
        </div>
        {rt && (
          <div className="rt-meta">
            {rt.hostname} · {rt.platform === 'darwin' ? 'macOS' : rt.platform === 'linux' ? 'Linux' : rt.platform} · {t('rt.versionMeta', { v: rt.version })}
            {remote && rt.publicUrl ? ` · ${rt.publicUrl.replace(/^https?:\/\//, '')}` : ''}
          </div>
        )}
        {remote && rt && <HostLine rt={rt} />}
      </div>
    </div>
  );
}

const AGENT_NAMES: Record<string, string> = { 'claude-code': 'Claude Code', codex: 'Codex', hermes: 'Hermes', opencode: 'OpenCode', openclaw: 'OpenClaw' };

/** On the cloud machine's page: which computer is lending its agents (Claude Code etc.) to the bots right now. */
function HostLine({ rt }: { rt: RuntimeInfo }) {
  const t = useT();
  const h = rt.agentHost;
  return (
    <div className={cx('rt-host', h ? 'ok' : 'off')}>
      <span className={cx('rt-host-dot', h ? 'ok' : 'off')} />
      {h ? (
        <span>
          {t('rt.hostOn', {
            name: h.name,
            agents: h.agents.length ? h.agents.map((a) => AGENT_NAMES[a] ?? a).join(t('common.listSep')) : t('rt.hostNoAgents'),
          })}
        </span>
      ) : (
        <span>{t('rt.hostOff')}</span>
      )}
    </div>
  );
}

/** On the computer's own page after a move: this computer is lending its agents to the bots over there. */
function LendingLine({ rt }: { rt: RuntimeInfo }) {
  const t = useT();
  const s = rt.hostLink;
  if (!s) return null;
  const text =
    s === 'connected' ? t('rt.lendConnected') : s === 'connecting' ? t('rt.lendConnecting') : s === 'no_token' ? t('rt.lendNoToken') : t('rt.lendOff');
  return (
    <div className={cx('rt-host', s === 'connected' ? 'ok' : 'off')}>
      <span className={cx('rt-host-dot', s === 'connected' ? 'ok' : s === 'connecting' ? 'wait' : 'off')} />
      <span>{text}</span>
    </div>
  );
}

function MovedNotice({ rt }: { rt: RuntimeInfo }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const go = () => {
    try {
      const p = parsePairingCode(code);
      setRuntime({ kind: 'remote', url: p.url, token: p.token, name: p.name });
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="rt-card notice">
      <div className="rt-ic">→</div>
      <div className="rt-main">
        <div className="rt-title">{tx('rt.movedTo', { name: <b>{rt.movedTo?.replace(/^https?:\/\//, '') || t('rt.anotherMachine')}</b> })}</div>
        <div className="rt-desc">{t('rt.movedDesc')}</div>
        <LendingLine rt={rt} />
        <div className="rt-row">
          <input className="mem-add" placeholder={t('rt.pairingCode')} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button className="btn sm primary" disabled={!code.trim()} onClick={go}>{t('rt.connectOver')}</button>
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
    </div>
  );
}

type Step = 'idle' | 'checking' | 'confirm' | 'moving' | 'done';
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** Where to get a machine that stays on. Copy is per vendor: what to pick when buying, where the IP / password / firewall live. */
const VENDORS: { id: string; url: string; user: string }[] = [
  { id: 'tencent', url: 'https://cloud.tencent.com/product/lighthouse', user: 'ubuntu' },
  { id: 'aliyun', url: 'https://www.aliyun.com/product/swas', user: 'root' },
  { id: 'own', url: '', user: 'root' },
];
/** A vendor's words, in the current language. */
const vendorText = (id: string) => ({
  name: tr(`rt.vendor.${id}.name`),
  tag: tr(`rt.vendor.${id}.tag`),
  buy: [1, 2, 3].map((i) => tr(`rt.vendor.${id}.buy${i}`)),
  after: [1, 2, 3].map((i) => tr(`rt.vendor.${id}.after${i}`)),
});

/** Four screens, one at a time: pick where to get a machine → set it up → run one command here → paste the code and move. */
function MoveOutCard() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [screen, setScreen] = useState(0);
  const [vendor, setVendor] = useState(VENDORS[0]);
  const [host, setHost] = useState('');
  const [user, setUser] = useState(VENDORS[0].user);
  const [password, setPassword] = useState('');
  const [domain, setDomain] = useState('');
  const [installing, setInstalling] = useState(false);
  const [sent, setSent] = useState<{ sent: number; total: number } | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLines]);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [peer, setPeer] = useState<{ url: string; token: string; name?: string; info: RuntimeInfo } | null>(null);
  const bots = useStore((s) => s.bots.length);

  const v = vendorText(vendor.id);
  const target = `${user.trim() || 'root'}@${host.trim() || 'SERVER-IP'}`;
  const rt = useStore((s) => s.runtime);
  const script = rt?.serverDir ? `${rt.serverDir}/deploy/remote-install.sh` : 'crew-server/deploy/remote-install.sh';
  const cmd = `bash ${script} ${target}${domain.trim() ? ` ${domain.trim()}` : ''}`;
  const copy = () => void navigator.clipboard?.writeText(cmd).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });

  const check = async (c = code) => {
    setErr('');
    setStep('checking');
    try {
      const p = parsePairingCode(c);
      const info = await probeRuntime(p.url, p.token);
      setPeer({ ...p, info });
      setStep('confirm');
    } catch (e) {
      setErr((e as Error).message);
      setStep('idle');
    }
  };
  const move = async () => {
    if (!peer) return;
    setStep('moving');
    setErr('');
    setSent(null);
    try {
      await agent.migrateTo(peer.url, peer.token, true, (a, b) => setSent({ sent: a, total: b }));
      setRuntime({ kind: 'remote', url: peer.url, token: peer.token, name: peer.name ?? peer.info.hostname, provider: 'byo' });
      setStep('done');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setErr((e as Error).message);
      setStep('idle');
    }
  };

  const install = async () => {
    setInstalling(true);
    setErr('');
    setLogLines([]);
    try {
      const r = await agent.remoteInstall({ host: host.trim(), user: user.trim(), password, domain: domain.trim() || undefined }, (line) => setLogLines((cur) => [...cur.slice(-400), line]));
      setPassword('');
      setCode(r.code);
      setScreen(3);
      void check(r.code);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setInstalling(false);
    }
  };

  const SCREENS = [t('rt.step1'), t('rt.step2'), t('rt.step3'), t('rt.step4')];
  // The steward: a bot that walks the user through the same four steps in conversation, with cards for the two actions.
  const [summoning, setSummoning] = useState(false);
  const summon = async () => {
    setSummoning(true);
    setErr('');
    try {
      const botId = await agent.startSteward('move_out');
      selectThread(toBotThread(botId));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSummoning(false);
    }
  };

  return (
    <div className="rt-card">
      <div className="rt-ic">☁</div>
      <div className="rt-main">
        <div className="rt-title">{t('rt.moveOut')}</div>
        <div className="rt-desc">{t('rt.moveOutDesc')}</div>
        {!open ? (
          <div className="rt-row">
            <button className="btn sm primary" disabled={summoning} onClick={() => void summon()}>{summoning ? t('rt.summoning') : t('rt.summon')}</button>
            <button className="btn sm" onClick={() => setOpen(true)}>{t('rt.selfServe')}</button>
            {err && <span className="rt-err">{err}</span>}
          </div>
        ) : (
          <div className="wiz">
            <ol className="wiz-nav">
              {SCREENS.map((t, i) => (
                <li key={t} className={cx(i === screen && 'on', i < screen && 'done')} onClick={() => i < screen && setScreen(i)}>
                  <span className="wiz-n">{i < screen ? '✓' : i + 1}</span>
                  <span className="wiz-t">{t}</span>
                </li>
              ))}
            </ol>

            {screen === 0 && (
              <div className="wiz-body">
                <div className="wiz-lead">{t('rt.pickLead')}</div>
                <div className="vendors">
                  {VENDORS.map((x) => (
                    <button key={x.id} className={cx('vendor', vendor.id === x.id && 'on')} onClick={() => { setVendor(x); setUser(x.user); }}>
                      <span className="vendor-n">{tr(`rt.vendor.${x.id}.name`)}</span>
                      <span className="vendor-t">{tr(`rt.vendor.${x.id}.tag`)}</span>
                    </button>
                  ))}
                </div>
                {vendor.url ? (
                  <>
                    <div className="wiz-sub">{t('rt.buyHow')}</div>
                    <ul className="wiz-list">{v.buy.map((b) => <li key={b}>{b}</li>)}</ul>
                    <div className="rt-row">
                      <a className="btn sm primary" href={vendor.url} target="_blank" rel="noopener noreferrer">{t('rt.goBuy', { name: v.name.split(' ')[0] })}</a>
                      <button className="btn sm" onClick={() => setScreen(1)}>{t('rt.bought')}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="wiz-sub">{t('rt.needs')}</div>
                    <ul className="wiz-list">{v.buy.map((b) => <li key={b}>{b}</li>)}</ul>
                    <div className="rt-row"><button className="btn sm primary" onClick={() => setScreen(1)}>{t('rt.meets')}</button></div>
                  </>
                )}
              </div>
            )}

            {screen === 1 && (
              <div className="wiz-body">
                <div className="wiz-lead">{t('rt.prepLead', { where: vendor.id === 'own' ? t('rt.thatMachine') : t('rt.console', { name: v.name.split(' ')[0] }) })}</div>
                <ul className="wiz-list">{v.after.map((b) => <li key={b}>{b}</li>)}</ul>
                <div className="wiz-fields">
                  <div className="wiz-two">
                    <label>
                      <span>{t('rt.publicIp')}</span>
                      <input className="mem-add" placeholder={t('rt.ipExample')} value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
                    </label>
                    <label className="narrow">
                      <span>{t('rt.loginUser')}</span>
                      <input className="mem-add" value={user} onChange={(e) => setUser(e.target.value)} />
                    </label>
                  </div>
                  <label>
                    <span>{t('rt.loginPass')} <em>{t('rt.loginPassNote')}</em></span>
                    <input className="mem-add" type="password" placeholder={t('rt.passPlaceholder')} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                  </label>
                  <label>
                    <span>{t('rt.domain')} <em>{t('rt.domainNote')}</em></span>
                    <input className="mem-add" placeholder={t('rt.domainPlaceholder')} value={domain} onChange={(e) => setDomain(e.target.value)} />
                  </label>
                </div>
                <div className="rt-row">
                  <button className="btn sm" onClick={() => setScreen(0)}>{t('rt.prev')}</button>
                  <button className="btn sm primary" disabled={!host.trim() || !password} onClick={() => setScreen(2)}>{t('rt.next')}</button>
                </div>
              </div>
            )}

            {screen === 2 && (
              <div className="wiz-body">
                <div className="wiz-lead">{t('rt.installLead')}</div>
                {!installing && !logLines.length && !err && (
                  <div className="rt-row">
                    <button className="btn sm" onClick={() => setScreen(1)}>{t('rt.prev')}</button>
                    <button className="btn sm primary" onClick={() => void install()}>{t('rt.installStart')}</button>
                  </div>
                )}
                {(installing || logLines.length > 0) && (
                  <pre className={cx('wiz-log', installing && 'live')} ref={logRef}>{logLines.length ? logLines.join('\n') : t('rt.installConnecting', { target: `${user}@${host}` })}{installing ? '\n▍' : ''}</pre>
                )}
                {err && !installing && (
                  <>
                    <div className="rt-err">{err}</div>
                    <div className="rt-row">
                      <button className="btn sm" onClick={() => setScreen(1)}>{t('rt.fixAndRetry')}</button>
                      <button className="btn sm primary" onClick={() => void install()}>{t('rt.retry')}</button>
                    </div>
                  </>
                )}
                <button className="link quiet-link wiz-manual" onClick={() => setManual(!manual)}>{manual ? t('common.collapse') : t('rt.manualQ')}</button>
                {manual && (
                  <div className="rt-cmd big">
                    <code>{cmd}</code>
                    <button className="link quiet-link" onClick={copy}>{copied ? t('common.copied') : t('common.copy')}</button>
                  </div>
                )}
              </div>
            )}

            {screen === 3 && (
              <div className="wiz-body">
                <div className="wiz-lead">{code ? t('rt.moveLeadFilled') : t('rt.moveLeadPaste')}{t('rt.moveLeadTail', { n: bots })}</div>
                <div className="rt-row">
                  <input className="mem-add" placeholder={t('rt.codePlaceholder')} value={code} disabled={step === 'moving'} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && step === 'idle' && code.trim() && void check()} autoFocus />
                  <button className="btn sm primary" disabled={!code.trim() || step !== 'idle'} onClick={() => void check()}>
                    {step === 'checking' ? t('rt.checking') : step === 'moving' ? t('rt.moving') : step === 'done' ? t('rt.moved2') : t('rt.checkAndMove')}
                  </button>
                </div>
                {step === 'moving' && (
                  <div className="rt-progress" style={{ marginTop: 10 }}>
                    <i className="tdots"><b /><b /><b /></i>
                    {!sent ? t('rt.packing') : sent.sent < sent.total ? t('rt.sending', { sent: mb(sent.sent), total: mb(sent.total) }) : t('rt.sent', { total: mb(sent.total) })}
                  </div>
                )}
                {step === 'done' && <div className="rt-ok" style={{ marginTop: 10 }}>{t('rt.movedSwitching')}</div>}
                {err && <div className="rt-err">{err}</div>}
                <div className="rt-row"><button className="btn sm" disabled={step === 'moving'} onClick={() => setScreen(2)}>{t('rt.prev')}</button></div>
              </div>
            )}
          </div>
        )}
      </div>
      {step === 'confirm' && peer && (
        <ConfirmDialog
          title={t('rt.moveAskTitle', { n: bots, name: peer.name ?? peer.info.hostname })}
          message={t('rt.moveAskMsg', {
            host: peer.info.hostname,
            platform: peer.info.platform === 'linux' ? 'Linux' : peer.info.platform,
            version: peer.info.version,
          })}
          confirmLabel={t('rt.moveOk')}
          onCancel={() => setStep('idle')}
          onConfirm={() => void move()}
        />
      )}
    </div>
  );
}

function MoveBackCard({ rt }: { rt?: RuntimeInfo }) {
  const t = useT();
  const [step, setStep] = useState<Step>('idle');
  const [err, setErr] = useState('');
  const [localOk, setLocalOk] = useState<boolean | null>(null);
  const target = getRuntime();
  useEffect(() => {
    if (!localHttpBase) return setLocalOk(false);
    fetch(`${localHttpBase}/runtime/info`).then((r) => setLocalOk(r.ok)).catch(() => setLocalOk(false));
  }, []);
  const back = async () => {
    if (target.kind !== 'remote') return;
    setStep('moving');
    setErr('');
    try {
      await oneShot(localWsUrl, { type: 'migrate_from', url: target.url, token: target.token }, 'migrated');
      setRuntime({ kind: 'local' });
      setStep('done');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      setErr((e as Error).message);
      setStep('idle');
    }
  };
  return (
    <div className="rt-card">
      <div className="rt-ic">⌂</div>
      <div className="rt-main">
        <div className="rt-title">{t('rt.backTitle')}</div>
        <div className="rt-desc">{localOk === false ? t('rt.backNoLocal') : t('rt.backDesc')}</div>
        <div className="rt-row">
          <button className="btn sm" disabled={!localOk || step !== 'idle'} onClick={() => setStep('confirm')}>
            {step === 'moving' ? t('rt.backing') : step === 'done' ? t('rt.switching') : t('rt.back')}
          </button>
          {step === 'moving' && <span className="rt-progress"><i className="tdots"><b /><b /><b /></i>{t('rt.dontClose')}</span>}
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {step === 'confirm' && (
        <ConfirmDialog
          title={t('rt.backAskTitle')}
          message={t('rt.backAskMsg', { name: rt?.hostname ?? t('rt.thatMachine') })}
          confirmLabel={t('rt.back')}
          onCancel={() => setStep('idle')}
          onConfirm={() => void back()}
        />
      )}
    </div>
  );
}

/** One button: we run the machine. Provision, then the same move as to any other machine. */
function HostedCard() {
  const t = useT();
  const bots = useStore((s) => s.bots.length);
  const [step, setStep] = useState<Step>('idle');
  const [err, setErr] = useState('');
  const go = async () => {
    setStep('moving');
    setErr('');
    try {
      const home = await provisionCloudHome(tr('rt.cloudName'));
      await agent.migrateTo(home.url, home.token, true);
      setRuntime({ kind: 'remote', url: home.url, token: home.token, name: tr('rt.cloudName'), provider: 'hosted' });
      setStep('done');
      setTimeout(() => window.location.reload(), 900);
    } catch (e) {
      setErr((e as Error).message);
      setStep('idle');
    }
  };
  return (
    <div className="rt-card hosted">
      <div className="rt-ic">☁</div>
      <div className="rt-main">
        <div className="rt-title">{t('rt.hostedTitle')} <span className="rt-tag">{t('rt.recommended')}</span></div>
        <div className="rt-desc">{t('rt.hostedDesc')}</div>
        <div className="rt-row">
          <button className="btn sm primary" disabled={step !== 'idle'} onClick={() => setStep('confirm')}>
            {step === 'moving' ? t('rt.hostedBooting') : step === 'done' ? t('rt.switching') : t('rt.hostedStart')}
          </button>
          {step === 'moving' && <span className="rt-progress"><i className="tdots"><b /><b /><b /></i>{t('rt.hostedWait')}</span>}
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {step === 'confirm' && (
        <ConfirmDialog
          title={t('rt.hostedAskTitle', { n: bots })}
          message={t('rt.hostedAskMsg')}
          confirmLabel={t('rt.hostedOk')}
          onCancel={() => setStep('idle')}
          onConfirm={() => void go()}
        />
      )}
    </div>
  );
}

/** After moving back from the cloud, the account still has a home there; offer to shut it down. */
function CloudLeftover() {
  const t = useT();
  const [home, setHome] = useState<{ id: string; name: string; running: boolean } | null | undefined>(undefined);
  const [ask, setAsk] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    cloudHomeStatus().then((h) => setHome(h ?? null)).catch(() => setHome(null));
  }, []);
  if (!home) return null;
  return (
    <div className="rt-card leftover">
      <div className="rt-ic">☁</div>
      <div className="rt-main">
        <div className="rt-title">{t('rt.leftoverTitle')}</div>
        <div className="rt-desc">{t('rt.leftoverDesc', { state: home.running ? t('rt.leftoverOn') : t('rt.leftoverOff') })}</div>
        <div className="rt-row"><button className="btn sm" onClick={() => setAsk(true)}>{t('rt.leftoverBtn')}</button></div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {ask && (
        <ConfirmDialog
          title={t('rt.leftoverAskTitle')}
          message={t('rt.leftoverAskMsg')}
          confirmLabel={t('rt.leftoverOk')}
          danger
          onCancel={() => setAsk(false)}
          onConfirm={() => {
            setAsk(false);
            destroyCloudHome(home.id).then(() => setHome(null)).catch((e) => setErr((e as Error).message));
          }}
        />
      )}
    </div>
  );
}
