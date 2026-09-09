import { select as selectThread } from '../store';
import { botThread as toBotThread } from '../types';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import type { RuntimeInfo } from '../types';
import { agent } from '../services/agent';
import { getRuntime, setRuntime, parsePairingCode, probeRuntime, oneShot, localWsUrl, localHttpBase } from '../services/runtime';
import { ConfirmDialog } from './ConfirmDialog';
import { cloudAvailable, provisionCloudHome, cloudHomeStatus, destroyCloudHome } from '../services/cloud';
import { cx } from '../utils';

/**
 * "Where the bots live." One page, plain words: which machine runs the bots right now, what that means,
 * and how to move them to a machine that stays on (or back). No servers, tokens or runtimes in the copy.
 */
export function RuntimeView() {
  const target = getRuntime();
  const remote = target.kind === 'remote';
  return (
    <section className="col thread">
      <header className="hd">
        <span className="rt-hd-ic">{remote ? '☁' : '⌂'}</span>
        <div className="who">
          <span className="n">bot 们在哪台机器上干活</span>
          <span className="t">它们的聊天记录、记忆和技能都在那台机器上。机器开着，它们就在办事。</span>
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
  const rt = useStore((s) => s.runtime);
  const online = useStore((s) => s.online);
  const target = getRuntime();
  const remote = target.kind === 'remote';
  return (
    <>
      <CurrentCard rt={rt} online={online} remote={remote} name={remote ? target.name : undefined} />
      {rt?.mode === 'moved' && <MovedNotice rt={rt} />}
      {!remote && rt?.mode !== 'moved' && cloudAvailable && <HostedCard />}
      {!remote && rt?.mode !== 'moved' && <MoveOutCard />}
      {remote && <MoveBackCard rt={rt} />}
      {!remote && cloudAvailable && <CloudLeftover />}
      <div className="rt-fine">搬家会把这台机器上的一切原样带走：聊天记录、事项、记忆、技能、连接和密钥。搬走后这台机器上只留一份不再运行的副本。</div>
    </>
  );
}

function CurrentCard({ rt, online, remote, name }: { rt?: RuntimeInfo; online?: boolean; remote: boolean; name?: string }) {
  const label = remote ? name || rt?.hostname || '我的服务器' : '这台电脑';
  const status = online === false ? '没连上' : rt ? (rt.mode === 'active' ? '在线' : rt.mode === 'moved' ? '已搬走' : '待命') : '连接中…';
  return (
    <div className={cx('rt-card current', remote && 'remote')}>
      <div className="rt-ic">{remote ? '☁' : '⌂'}</div>
      <div className="rt-main">
        <div className="rt-title">
          现在在 <b>{label}</b>
          <span className={cx('rt-status', online === false ? 'off' : rt?.mode === 'active' ? 'ok' : 'warn')}>{status}</span>
        </div>
        <div className="rt-desc">
          {remote
            ? '这台机器 24 小时开着。你关电脑、出门、睡觉，bot 都照常干活，办完在这里和 IM 里告诉你。'
            : '这台电脑关了或者睡了，bot 就停下；醒来接着做没做完的事。想让它们一直在，把它们搬到一台不关机的机器上。'}
        </div>
        {rt && (
          <div className="rt-meta">
            {rt.hostname} · {rt.platform === 'darwin' ? 'macOS' : rt.platform === 'linux' ? 'Linux' : rt.platform} · 版本 {rt.version}
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
  const h = rt.agentHost;
  return (
    <div className={cx('rt-host', h ? 'ok' : 'off')}>
      <span className={cx('rt-host-dot', h ? 'ok' : 'off')} />
      {h ? (
        <span>
          你的电脑「{h.name}」在线，bot 可以借用它上面的 {h.agents.length ? h.agents.map((a) => AGENT_NAMES[a] ?? a).join('、') : '外部 agent（还没装）'}。电脑关了就借不了，其他事照常。
        </span>
      ) : (
        <span>你的电脑不在线。Claude Code 这类装在电脑上的 agent，要电脑开着、电脑上的 EverBot 开着，bot 才能借用；其他事不受影响。</span>
      )}
    </div>
  );
}

/** On the computer's own page after a move: this computer is lending its agents to the bots over there. */
function LendingLine({ rt }: { rt: RuntimeInfo }) {
  const s = rt.hostLink;
  if (!s) return null;
  const text =
    s === 'connected'
      ? '这台电脑正把本机的 Claude Code 等 agent 借给那边的 bot 用。电脑开着、EverBot 开着，它们就能用；关了就暂时用不了，其他事不受影响。'
      : s === 'connecting'
        ? '正在连那台机器，好把本机的 agent 借给那边的 bot 用…'
        : s === 'no_token'
          ? '这台电脑上没有那台机器的连接凭据，本机的 agent 借不出去。重新搬一次就会带上。'
          : '本机 agent 转接没开。';
  return (
    <div className={cx('rt-host', s === 'connected' ? 'ok' : 'off')}>
      <span className={cx('rt-host-dot', s === 'connected' ? 'ok' : s === 'connecting' ? 'wait' : 'off')} />
      <span>{text}</span>
    </div>
  );
}

function MovedNotice({ rt }: { rt: RuntimeInfo }) {
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
        <div className="rt-title">bot 已经搬到 <b>{rt.movedTo?.replace(/^https?:\/\//, '') || '另一台机器'}</b></div>
        <div className="rt-desc">这台电脑上只剩一份不再运行的副本。要看它们，连到那台机器去；把那台机器的连接码贴在下面。</div>
        <LendingLine rt={rt} />
        <div className="rt-row">
          <input className="mem-add" placeholder="连接码" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} />
          <button className="btn sm primary" disabled={!code.trim()} onClick={go}>连过去</button>
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
    </div>
  );
}

type Step = 'idle' | 'checking' | 'confirm' | 'moving' | 'done';
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/** Where to get a machine that stays on. Copy is per vendor: what to pick when buying, where the IP / password / firewall live. */
const VENDORS: { id: string; name: string; tag: string; url: string; user: string; buy: string[]; after: string[] }[] = [
  {
    id: 'tencent',
    name: '腾讯云 轻量应用服务器',
    tag: '国内最省事',
    url: 'https://cloud.tencent.com/product/lighthouse',
    user: 'ubuntu',
    buy: ['创建方式选「基于操作系统镜像」，系统 Ubuntu 22.04', '地域：模型走境外服务或要配域名就选香港，否则选离你近的', '套餐 2 核 4G 那档；登录方式选「自定义密码」自己设一个'],
    after: ['实例卡片上能看到公网 IP', '登录用户名是 ubuntu，密码是你购买时设的（忘了就「重置密码」）', '「防火墙」放开 80、443（不打算配域名就放开 5200）'],
  },
  {
    id: 'aliyun',
    name: '阿里云 轻量应用服务器',
    tag: '同样简单',
    url: 'https://www.aliyun.com/product/swas',
    user: 'root',
    buy: ['实例选「通用型」，不要「智能体专用型」', '镜像选 Ubuntu 22.04', '套餐 2 核 4G 那档；地域按同样的原则选'],
    after: ['服务器概览里有公网 IP', '登录用户名是 root，「重置密码」设一个密码', '「防火墙」放开 80、443（不打算配域名就放开 5200）'],
  },
  {
    id: 'own',
    name: '我已经有一台机器',
    tag: '云主机 / 小主机 / NAS',
    url: '',
    user: 'root',
    buy: ['Linux 系统（Ubuntu、Debian 都行）', '24 小时开着，有固定的 IP 或域名', '能从这台电脑 ssh 登上去'],
    after: ['记下它的 IP 和登录账号', '路由器或防火墙放开 80、443（或 5200）', 'Docker 不用提前装，脚本会装'],
  },
];

/** Four screens, one at a time: pick where to get a machine → set it up → run one command here → paste the code and move. */
function MoveOutCard() {
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

  const target = `${user.trim() || 'root'}@${host.trim() || '服务器IP'}`;
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

  const SCREENS = ['选一台机器', '准备好它', '装好它', '搬过去'];
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
        <div className="rt-title">搬到一台不关机的机器</div>
        <div className="rt-desc">一台 24 小时开着的 Linux 机器就行。买一台最低配的云主机，跟着四步走，十分钟左右。</div>
        {!open ? (
          <div className="rt-row">
            <button className="btn sm primary" disabled={summoning} onClick={() => void summon()}>{summoning ? '叫管家…' : '让管家带我做'}</button>
            <button className="btn sm" onClick={() => setOpen(true)}>自己按步骤来</button>
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
                <div className="wiz-lead">在哪儿弄一台机器？选一个，后面的说明会按它来写。</div>
                <div className="vendors">
                  {VENDORS.map((v) => (
                    <button key={v.id} className={cx('vendor', vendor.id === v.id && 'on')} onClick={() => { setVendor(v); setUser(v.user); }}>
                      <span className="vendor-n">{v.name}</span>
                      <span className="vendor-t">{v.tag}</span>
                    </button>
                  ))}
                </div>
                {vendor.url ? (
                  <>
                    <div className="wiz-sub">购买时这样选</div>
                    <ul className="wiz-list">{vendor.buy.map((b) => <li key={b}>{b}</li>)}</ul>
                    <div className="rt-row">
                      <a className="btn sm primary" href={vendor.url} target="_blank" rel="noopener noreferrer">去 {vendor.name.split(' ')[0]} 购买 ↗</a>
                      <button className="btn sm" onClick={() => setScreen(1)}>买好了，下一步</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="wiz-sub">它需要满足</div>
                    <ul className="wiz-list">{vendor.buy.map((b) => <li key={b}>{b}</li>)}</ul>
                    <div className="rt-row"><button className="btn sm primary" onClick={() => setScreen(1)}>满足，下一步</button></div>
                  </>
                )}
              </div>
            )}

            {screen === 1 && (
              <div className="wiz-body">
                <div className="wiz-lead">在 {vendor.name.split(' ')[0] === '我已经有一台机器' ? '那台机器' : `${vendor.name.split(' ')[0]}控制台`} 做三件事，然后把 IP 填在下面。</div>
                <ul className="wiz-list">{vendor.after.map((b) => <li key={b}>{b}</li>)}</ul>
                <div className="wiz-fields">
                  <div className="wiz-two">
                    <label>
                      <span>公网 IP</span>
                      <input className="mem-add" placeholder="例如 43.12.34.56" value={host} onChange={(e) => setHost(e.target.value)} autoFocus />
                    </label>
                    <label className="narrow">
                      <span>登录用户名</span>
                      <input className="mem-add" value={user} onChange={(e) => setUser(e.target.value)} />
                    </label>
                  </div>
                  <label>
                    <span>登录密码 <em>只用这一次，装完就丢掉，不会保存</em></span>
                    <input className="mem-add" type="password" placeholder="购买时设的密码" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
                  </label>
                  <label>
                    <span>域名 <em>可选，填了会自动配 HTTPS，需先把域名解析到这个 IP</em></span>
                    <input className="mem-add" placeholder="例如 bots.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} />
                  </label>
                </div>
                <div className="rt-row">
                  <button className="btn sm" onClick={() => setScreen(0)}>上一步</button>
                  <button className="btn sm primary" disabled={!host.trim() || !password} onClick={() => setScreen(2)}>下一步</button>
                </div>
              </div>
            )}

            {screen === 2 && (
              <div className="wiz-body">
                <div className="wiz-lead">点一下，App 会自己连到那台机器：传代码、装 Docker、启动服务，几分钟。装完自动进入下一步。</div>
                {!installing && !logLines.length && !err && (
                  <div className="rt-row">
                    <button className="btn sm" onClick={() => setScreen(1)}>上一步</button>
                    <button className="btn sm primary" onClick={() => void install()}>开始安装</button>
                  </div>
                )}
                {(installing || logLines.length > 0) && (
                  <pre className={cx('wiz-log', installing && 'live')} ref={logRef}>{logLines.length ? logLines.join('\n') : `正在连接 ${user}@${host}…`}{installing ? '\n▍' : ''}</pre>
                )}
                {err && !installing && (
                  <>
                    <div className="rt-err">{err}</div>
                    <div className="rt-row">
                      <button className="btn sm" onClick={() => setScreen(1)}>改一下再试</button>
                      <button className="btn sm primary" onClick={() => void install()}>重试</button>
                    </div>
                  </>
                )}
                <button className="link quiet-link wiz-manual" onClick={() => setManual(!manual)}>{manual ? '收起' : '想自己在终端里跑？'}</button>
                {manual && (
                  <div className="rt-cmd big">
                    <code>{cmd}</code>
                    <button className="link quiet-link" onClick={copy}>{copied ? '已复制' : '复制'}</button>
                  </div>
                )}
              </div>
            )}

            {screen === 3 && (
              <div className="wiz-body">
                <div className="wiz-lead">{code ? '连接码已经填好。' : '把安装结束时打印的连接码贴到这里。'}检查通过会问你一次确认，然后把这台电脑上的 {bots} 个 bot 搬过去。</div>
                <div className="rt-row">
                  <input className="mem-add" placeholder="以 ey 开头的一长串" value={code} disabled={step === 'moving'} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && step === 'idle' && code.trim() && void check()} autoFocus />
                  <button className="btn sm primary" disabled={!code.trim() || step !== 'idle'} onClick={() => void check()}>
                    {step === 'checking' ? '正在联系…' : step === 'moving' ? '搬家中…' : step === 'done' ? '好了' : '检查并搬过去'}
                  </button>
                </div>
                {step === 'moving' && (
                  <div className="rt-progress" style={{ marginTop: 10 }}>
                    <i className="tdots"><b /><b /><b /></i>
                    {!sent ? '正在打包，别关页面' : sent.sent < sent.total ? `正在送过去 ${mb(sent.sent)} / ${mb(sent.total)} MB，别关页面` : `已送到（${mb(sent.total)} MB），对方正在接收…`}
                  </div>
                )}
                {step === 'done' && <div className="rt-ok" style={{ marginTop: 10 }}>搬好了，正在切换…</div>}
                {err && <div className="rt-err">{err}</div>}
                <div className="rt-row"><button className="btn sm" disabled={step === 'moving'} onClick={() => setScreen(2)}>上一步</button></div>
              </div>
            )}
          </div>
        )}
      </div>
      {step === 'confirm' && peer && (
        <ConfirmDialog
          title={`把 ${bots} 个 bot 搬到「${peer.name ?? peer.info.hostname}」？`}
          message={`那台机器：${peer.info.hostname}，${peer.info.platform === 'linux' ? 'Linux' : peer.info.platform}，版本 ${peer.info.version}。搬家期间 bot 会停几分钟；搬完这台电脑上的 bot 不再运行，聊天记录、记忆、技能和密钥都带过去。`}
          confirmLabel="搬过去"
          onCancel={() => setStep('idle')}
          onConfirm={() => void move()}
        />
      )}
    </div>
  );
}

function MoveBackCard({ rt }: { rt?: RuntimeInfo }) {
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
        <div className="rt-title">搬回这台电脑</div>
        <div className="rt-desc">
          {localOk === false ? '这台电脑上的服务没在运行，先把它启动起来，这里才能接收。' : '把 bot 从那台机器接回来，在这台电脑上继续。之后它们又会跟着这台电脑开关。'}
        </div>
        <div className="rt-row">
          <button className="btn sm" disabled={!localOk || step !== 'idle'} onClick={() => setStep('confirm')}>
            {step === 'moving' ? '正在接回…' : step === 'done' ? '好了，正在切换…' : '搬回来'}
          </button>
          {step === 'moving' && <span className="rt-progress"><i className="tdots"><b /><b /><b /></i>别关页面</span>}
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {step === 'confirm' && (
        <ConfirmDialog
          title="把 bot 搬回这台电脑？"
          message={`「${rt?.hostname ?? '那台机器'}」上的 bot 会停下并搬回来，这台电脑上原有的旧副本会被替换。`}
          confirmLabel="搬回来"
          onCancel={() => setStep('idle')}
          onConfirm={() => void back()}
        />
      )}
    </div>
  );
}

/** One button: we run the machine. Provision, then the same move as to any other machine. */
function HostedCard() {
  const bots = useStore((s) => s.bots.length);
  const [step, setStep] = useState<Step>('idle');
  const [err, setErr] = useState('');
  const go = async () => {
    setStep('moving');
    setErr('');
    try {
      const home = await provisionCloudHome('云端');
      await agent.migrateTo(home.url, home.token, true);
      setRuntime({ kind: 'remote', url: home.url, token: home.token, name: '云端', provider: 'hosted' });
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
        <div className="rt-title">云端常驻 <span className="rt-tag">推荐</span></div>
        <div className="rt-desc">我们给你开一台一直在线的机器，bot 搬过去后 24 小时干活，关电脑、出门都不影响。不用装任何东西。</div>
        <div className="rt-row">
          <button className="btn sm primary" disabled={step !== 'idle'} onClick={() => setStep('confirm')}>
            {step === 'moving' ? '正在开机、搬家…' : step === 'done' ? '好了，正在切换…' : '开启云端常驻'}
          </button>
          {step === 'moving' && <span className="rt-progress"><i className="tdots"><b /><b /><b /></i>一两分钟，别关页面</span>}
        </div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {step === 'confirm' && (
        <ConfirmDialog
          title={`把 ${bots} 个 bot 搬到云端？`}
          message="会先给你开一台机器，再把这台电脑上的 bot 连同聊天记录、记忆、技能和密钥一起搬过去。搬家期间 bot 停几分钟；之后这台电脑上的不再运行。随时可以搬回来。"
          confirmLabel="开启"
          onCancel={() => setStep('idle')}
          onConfirm={() => void go()}
        />
      )}
    </div>
  );
}

/** After moving back from the cloud, the account still has a home there; offer to shut it down. */
function CloudLeftover() {
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
        <div className="rt-title">云端上还留着一台机器</div>
        <div className="rt-desc">上次搬回来后，云端那台机器还在（{home.running ? '开着' : '停着'}），上面是一份不再运行的旧副本。不再需要就注销，会先留一份备份。</div>
        <div className="rt-row"><button className="btn sm" onClick={() => setAsk(true)}>注销云端机器</button></div>
        {err && <div className="rt-err">{err}</div>}
      </div>
      {ask && (
        <ConfirmDialog
          title="注销云端那台机器？"
          message="机器和上面的旧副本会被删除，我们会留一份最终备份。这台电脑上的 bot 不受影响。"
          confirmLabel="注销"
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
