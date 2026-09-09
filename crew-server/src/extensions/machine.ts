import type { InlineExtension } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { StringEnum } from '@earendil-works/pi-ai';
import { connect as tcpConnect } from 'node:net';
import type { BotCtx } from './ctx.ts';
import type { CrewOps } from './crew-tools.ts';
import type { Card, ThreadId } from '../types.ts';
import { loadMachine, machineLink, pairMachine, probeMachine, uploadCode } from '../machine.ts';
import { pathMtu } from '../remote-install.ts';

/**
 * Steward-only tools: eyes and hands on the one machine the user connected. Everything the steward does there
 * shows up in the conversation as a "run" card with the command and its live output, so the user can watch.
 * Credentials never pass through here: the card posts them to the server; outputs come back redacted.
 */
export function machineExtension(c: BotCtx, ops: () => CrewOps): InlineExtension {
  const threadOf = (): ThreadId => c.current()?.threadId ?? (`bot:${c.botId}` as const);

  /** A card that shows one command (or action) running on the machine, with its output streaming in. */
  const runCard = (why: string, command?: string) => {
    const msg = c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: why, ts: Date.now(), card: { type: 'machine', stage: 'run', title: why, command, state: 'running', log: [] } });
    const log: string[] = [];
    const patch = (p: Partial<Extract<Card, { type: 'machine' }>>) => {
      const cur = c.store.message(msg.id)?.card;
      if (cur?.type === 'machine') c.store.patchMessage(msg.id, { card: { ...cur, ...p } });
    };
    let last = 0;
    return {
      line(l: string) {
        log.push(l);
        if (Date.now() - last > 250) {
          last = Date.now();
          patch({ log: log.slice(-400) });
        }
      },
      done(exit: number, error?: string) {
        patch({ log: log.slice(-400), state: exit === 0 && !error ? 'done' : 'error', exit, error });
      },
    };
  };
  const tail = (s: string, n = 6000) => (s.length > n ? `…（前面省略 ${s.length - n} 字）\n` + s.slice(-n) : s);

  return {
    name: 'crew-machine',
    factory: (pi) => {
      pi.registerTool({
        name: 'machine_status',
        label: '看机器',
        description: '现状：这台电脑上有几个 bot、是否还在这里跑；用户连了哪台机器、配对了没、从这里能不能访问它的服务。每一轮先调它。',
        promptSnippet: '看看 bot 们现在在哪、目标机器连上没、配对没、能不能访问',
        parameters: Type.Object({}),
        async execute() {
          const s = await ops().machineStatus();
          const here = `这台电脑：${s.here.hostname}（${s.here.platform}），bot ${s.here.bots} 个，${s.here.mode === 'active' ? '正在这里跑' : s.here.mode === 'moved' ? '已经搬走' : '待命'}`;
          if (!s.target) return { content: [{ type: 'text', text: `${here}\n目标机器：还没有。用户还没在连接卡上填过机器。` }], details: s };
          const t = s.target;
          const pair = !t.url
            ? '还没配对（装好后 machine_pair）'
            : `已配对 ${t.url}，${t.reachable ? `从这里能访问它的服务${t.note ? `，但${t.note}` : ''}` : `从这里访问不到它的 ${t.port} 端口。${t.note ?? ''}让用户去云控制台这台机器的「防火墙」加规则：协议 TCP、端口 ${t.port}、来源全部；做完再 machine_probe 复查。`}`;
          return { content: [{ type: 'text', text: `${here}\n目标机器：${t.user}@${t.host}（${t.name}），${new Date(t.connectedAt).toLocaleString('zh-CN', { hour12: false })} 连上；${pair}` }], details: s };
        },
      });

      pi.registerTool({
        name: 'machine_card',
        label: '发机器卡',
        description:
          '在对话里放一张要用户操作的卡。stage=connect：连接卡，用户填机器的公网 IP、登录用户名、密码，点连接；连上后密码存进本机凭据（不经过你），系统把那台机器的体检结果发给你。stage=move：搬家卡，把这台电脑上的 bot 们整个搬到已配对且能访问的那台机器，用户点「搬过去」即可。',
        promptSnippet: '发连接卡（用户填 IP / 账号 / 密码）或搬家卡（用户点一下把 bot 们搬过去）',
        promptGuidelines: [
          '任何时候都不要让用户把密码发在对话里；要密码只有一种方式：machine_card(stage=connect)。',
          '一张卡发出后不要重复发；用户填完或点完，系统会通知你，那时再继续。用户说卡片出错、要换机器再发一张。',
          '发 move 卡之前必须 machine_pair 成功且 machine_probe 显示服务从外面能访问；否则先解决。',
        ],
        parameters: Type.Object({
          stage: StringEnum(['connect', 'move'] as const),
          title: Type.Optional(Type.String({ description: '卡片标题，缺省有合适的默认值' })),
          user: Type.Optional(Type.String({ description: 'connect：默认登录用户名。腾讯云轻量是 ubuntu，阿里云和多数机器是 root' })),
        }),
        async execute(_id, p) {
          if (p.stage === 'connect') {
            c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: `${p.title ?? '把那台机器的信息填在这里'}。密码只存在这台电脑的凭据文件里，我看不到。`, ts: Date.now(), card: { type: 'machine', stage: 'connect', title: p.title ?? '连接那台机器', user: p.user, state: 'idle' } });
            return { content: [{ type: 'text', text: '连接卡已发到对话里。用户填好点连接后，系统会把连接结果和机器体检发给你；现在不要追问，结束这一轮。' }], details: { stage: 'connect' } };
          }
          const s = await ops().machineStatus();
          if (!s.target?.url) throw new Error('那台机器还没配对：先装好、machine_pair');
          if (!s.target.reachable) throw new Error(`从外面访问不到那台机器的 ${s.target.port} 端口，先带用户放开防火墙，再 machine_probe 复查`);
          c.store.addMessage({ threadId: threadOf(), author: 'bot', botId: c.botId, text: p.title ?? `都准备好了。点一下，bot 们就搬到「${s.target.name}」上去。`, ts: Date.now(), card: { type: 'machine', stage: 'move', title: p.title ?? `搬到「${s.target.name}」`, state: 'idle', target: { url: s.target.url, name: s.target.name, bots: s.here.bots } } });
          return { content: [{ type: 'text', text: '搬家卡已发到对话里。用户点「搬过去」后由系统执行，搬完 App 会切到新机器，你在那边继续；现在不要追问，结束这一轮。' }], details: { stage: 'move' } };
        },
      });

      pi.registerTool({
        name: 'machine_probe',
        label: '探网络',
        description: '从这台电脑看到那台机器的网络：22 端口通不通；大包（1500 字节）能不能过去——过不去而小包能过，就是 MTU 黑洞，任何上传和 App 直连都会卡死，要把那台机器的 MTU 调低（见技能）；已配对的话，它的服务端口从外面能不能访问。上传前、装完后、用户说放开防火墙了之后，各调一次。',
        promptSnippet: '从外面探那台机器：ssh 通不通、大包过不过（MTU）、服务端口开没开',
        parameters: Type.Object({}),
        async execute() {
          const m = loadMachine();
          if (!m) throw new Error('还没有连上任何机器');
          const ssh = await new Promise<boolean>((resolve) => {
            const s = tcpConnect({ host: m.host, port: m.port || 22, timeout: 5000 });
            s.once('connect', () => (s.destroy(), resolve(true)));
            s.once('timeout', () => (s.destroy(), resolve(false)));
            s.once('error', () => resolve(false));
          });
          const mtu = await pathMtu(m.host);
          const mtuText = mtu === 'ok' ? '大包能过（MTU 正常）' : mtu === 'low' ? '1500 字节的大包过不去、1200 字节的能过：MTU 黑洞。上传前先在那台机器上执行技能里的「调 MTU」命令（1300），跑安装脚本时带上 CREW_MTU=1300' : '大包探测没有结论（ICMP 被拦）；如果上传卡住，按 MTU 黑洞处理';
          let svc = '服务：还没配对';
          if (m.url && m.token) {
            const p = await probeMachine({ url: m.url, token: m.token });
            svc = p.reachable ? `服务 ${m.url}：从外面能访问${p.note ? `，但${p.note}` : ''}` : `服务 ${m.url}：从外面访问不到（${p.note ?? ''}）`;
          }
          return { content: [{ type: 'text', text: `ssh（${m.port || 22} 端口）：${ssh ? '通' : '不通'}\n${mtuText}\n${svc}` }], details: { ssh, mtu } };
        },
      });

      pi.registerTool({
        name: 'machine_ssh',
        label: '在机器上执行',
        description:
          '在那台机器上执行一条 shell 命令（只在那台机器，不在本机），返回退出码和输出。sudo 可以直接用，密码由系统代答。命令和输出会以卡片形式显示在对话里，用户看得见。长任务（安装脚本、装 Docker）把 timeout_s 给足（最多 1800）。安装脚本：sudo env CREW_MTU=<需要时> bash /opt/crew/crew-server/deploy/install.sh。',
        promptSnippet: '在那台机器上跑命令：体检、装依赖、跑安装脚本、改配置、看日志',
        promptGuidelines: [
          '一条命令做一件事，看完输出再决定下一条；报错先读原因再修，不要盲目重跑。',
          '不要在命令里回显或保存密码、token；不要 cat .env（系统会打码，也没必要）。',
          '不要做与安装、诊断、维护这台机器无关的事；不要删用户数据（/data、docker volume crew-data）。',
        ],
        parameters: Type.Object({
          command: Type.String({ description: 'shell 命令，bash 语法' }),
          why: Type.String({ description: '给用户看的一句话：这一步在做什么，如「装 Docker」「看看为什么起不来」' }),
          timeout_s: Type.Optional(Type.Number({ description: '最长等多久，秒；默认 120，最多 1800' })),
        }),
        async execute(_id, p) {
          const l = machineLink();
          const card = runCard(p.why, p.command);
          try {
            const r = await l.exec(p.command, { pty: true, timeoutMs: Math.min(Math.max(p.timeout_s ?? 120, 5), 1800) * 1000, onLine: (x) => card.line(x) });
            card.done(r.code, r.timedOut ? `超过 ${p.timeout_s ?? 120} 秒没结束，已中止` : undefined);
            return { content: [{ type: 'text', text: `退出码 ${r.code}${r.timedOut ? '（超时中止）' : ''}\n${tail(r.out) || '（没有输出）'}` }], details: { code: r.code, timedOut: r.timedOut } };
          } catch (e) {
            card.done(1, (e as Error).message);
            throw e;
          }
        },
      });

      pi.registerTool({
        name: 'machine_upload',
        label: '上传代码',
        description: '把本产品的服务端代码放到那台机器的 /opt/crew/crew-server（只有代码，约 200 KB；技能库由那台机器构建时自己从 GitHub 拉）。机器上已是同一份就跳过。上传卡住通常是 MTU 黑洞，先 machine_probe。',
        promptSnippet: '把服务端代码放到那台机器上',
        parameters: Type.Object({}),
        async execute() {
          const l = machineLink();
          const card = runCard('把服务端代码放到那台机器上', 'upload → /opt/crew/crew-server');
          try {
            const r = await uploadCode(l, (x) => card.line(x));
            card.done(0);
            return { content: [{ type: 'text', text: r.skipped ? '那台机器上已经是这份代码，没有重传。下一步跑安装脚本。' : `代码已放到 /opt/crew/crew-server（${(r.bytes / 1024).toFixed(0)} KB）。下一步跑安装脚本。` }], details: r };
          } catch (e) {
            card.done(1, (e as Error).message);
            throw e;
          }
        },
      });

      pi.registerTool({
        name: 'machine_pair',
        label: '配对',
        description: '安装脚本跑成功后调用：从那台机器读回服务的地址和配对令牌，存进本机凭据（你拿不到令牌），并从外面测一次服务能不能访问。之后 machine_status / machine_probe 就能看到服务状态，也才能发搬家卡。',
        promptSnippet: '装好后配对：记下那台机器的服务地址，从外面测能不能访问',
        parameters: Type.Object({}),
        async execute() {
          const l = machineLink();
          const r = await pairMachine(l);
          const text = r.reachable ? `已配对：「${r.name}」${r.url}，从外面能访问。可以发搬家卡了。` : `已配对：「${r.name}」${r.url}，但从外面访问不到 ${r.port} 端口（${r.note ?? ''}）。让用户去云控制台这台机器的「防火墙」加规则：协议 TCP、端口 ${r.port}、来源全部；做完回一句，然后 machine_probe 复查。`;
          return { content: [{ type: 'text', text }], details: r };
        },
      });
    },
  };
}
