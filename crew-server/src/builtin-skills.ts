import type { SkillStore } from './skills.ts';

/**
 * Skills every bot carries: how to get the user through the three kinds of integration.
 * Written once into the skill store; the user can edit them afterwards like any skill.
 */
export const BUILTIN_SKILLS: { name: string; description: string; body: string }[] = [
  {
    name: 'Connecting a messenger',
    description:
      'How to put yourself into WeChat / Telegram / Discord / WhatsApp / Slack / Feishu / WeCom: WeChat is a QR code the user scans. For the rest, prefer driving the platform console yourself and harvesting the credentials; fall back to a credential card only when the computer is unavailable.',
    body: `## Purpose
Put yourself inside the messenger the user already lives in. Once connected, what they say there arrives at the same you, in the same thread, against the same matters; your replies and decision cards go back there.

Supported today: WeChat, Telegram, Discord, WhatsApp, Slack, Feishu / Lark, WeCom. The middle four are the common ones globally; WeChat, Feishu and WeCom are mostly used in China. If the user has not said which, ask — do not pick for them.

**WeChat is the exception and takes one step**: no console, no credentials, no route to choose. build(aspect=channel, action=add, value="WeChat") puts a QR code in the thread, the user scans it with their phone, and you are in. The two routes below are for everything else.

## When to use this
The user says "I want to use you in WeChat / Feishu / Telegram", "put you in our group", "how do I find you in Feishu" — or you decide for yourself that you should live in a particular messenger.

## The model: one bot is one bot account
In Telegram / Discord / WhatsApp / Slack / Feishu / WeCom you are an **independent bot account**, with your own name, avatar and credentials. A direct message to that account is a message to you; put several of these accounts in one group and you work there together (@ someone and they answer; a group there maps to a group here). There is no "connect the channel, then bind a session", and no /bind command.

## Two routes; the user picks
**Route one: you connect yourself.** Use the computer (computer(open)) to open the platform's console, create the bot, enable the permissions and subscribe the events yourself, then harvest the credentials straight into config. The user only helps at the login step (a QR card or a password card).
**Route two: the user creates it and fills in a card.** build(aspect=channel, action=add, value="Feishu") sends the standard credential card; the user follows the steps on it in the platform console and fills the credentials into the card.
**Ask once before starting**: use ask_user with two options — "I'll do it in the console myself (you log in once)" and "You create it from the card and I'll connect it" — and say which route is smoother for this platform (Telegram: route two; Feishu: either). Exception: recall the user's preference about this. If they have **chosen the same route every time**, take it without asking. When they choose this time, remember "prefers route X for messengers". If past choices disagree, ask.
When the computer will not start (computer(open) errors), only route two exists — do not ask.
In neither route do credentials pass through the conversation: never ask the user for a token or a secret, never have them paste one in the thread, never have them edit a config file, and do not edit config yourself.

## Route one, step by step
0. \`harvest(action=info, target=Feishu)\`: what this messenger needs, what the bot should be called, and what you must give the other side (WeCom and WhatsApp callback URLs, public IP).
1. \`computer(open)\`, then \`browser_navigate\` to the console (the address is in info). **When a login is needed, do not tell the user to go to the computer**: if the page shows a QR code, \`ask_login(kind=qr, url=part of the current address, selector=the QR element)\` puts the live code in the thread for them to scan with their phone; if it is a password form, \`ask_login(kind=password, passwordSelector=…)\` and they fill the card, which the system types into the page. End the turn there — the system wakes you when the login succeeds. The code on the card is live (re-fetched from the page every few seconds) so it cannot go stale; only rarely is a code impossible to crop (drawn inside a cross-origin iframe), and only then do you fall back to asking the user to open the computer's screen and scan it there.
   - How to scan is already written on the card (which app, which entry point; these codes only work with that platform's own scanner, not the system camera). Do not invent your own instructions. If the user says it will not scan, have them follow the card first. The card is meant to be looked at on a computer screen and scanned with a phone — if they only have a phone, use route two.
   - **Never ask the user for a phone number, an SMS code, or a login code from inside an app.** Those are credentials to their entire account and must not pass through the conversation. Logging in has exactly two paths: the QR card and the password card.
2. Work through the platform's steps on the page: create the app / bot (use your own name), add bot capability, enable permissions, subscribe events, publish. Read the snapshot that comes back after each step, and only click things in your own tab.
3. At the credentials page: if a secret is masked, click "view / show" first, then \`harvest(take, target=Feishu, field=App ID, url=part of the current address)\`, then \`harvest(take, field=App Secret, …)\`. When several values on the page share a format, add near (the label text beside it). Once the set is complete the system connects it and tells you the name on the other side.
4. **Verify (mandatory; without this it is not connected)**: \`channel_check(arm, channel=Feishu)\` gives you a passphrase → go back to the computer and open the **web client** of that messenger (the one the user is already logged into, not the developer console), search for your own bot name, and send the passphrase to yourself as the user → \`channel_check(status)\`. Only ok means it actually works; this test message never enters the thread.
   - Cannot find yourself: the app is unpublished, or its availability does not include this user. Fix it in the console and verify again.
   - Found, sent, still waiting: events are not subscribed (missing "receive messages"), long connection not selected, or the version is still in review.
   - Only after two failures do you tell the user, and then say exactly which step is stuck and what you need from them (usually an admin approval).
5. Once verified: tell the user in one line in the App where to find you (what the bot is called over there), and say one thing to them in that messenger.
6. After it works, use build(aspect=skill, action=set) to write yourself a "connecting X, in practice" manual: which menus you actually clicked, the exact button labels, where you got stuck, how you got round it. No credentials in it. Next time you or a colleague connect that platform, you follow it.

### What each platform prefers
- **Telegram**: **recommend route two when you ask.** It has no separate developer console — creating a bot means talking to @BotFather from the user's own account, so route one would mean logging their entire personal Telegram into this shared computer, and its login code only works with the scanner under Settings → Devices → Add Device, where users routinely get stuck. So: build(aspect=channel, action=add, value="Telegram") sends the credential card, and they find @BotFather in Telegram on their phone: /newbot → display name is your name, username ends in bot → paste the token it returns onto the card. A minute's work. Only take route one if they explicitly ask you to do it (web.telegram.org QR login → talk to @BotFather → harvest(field=Bot Token)). In a group it only sees messages that @ it, which is what you want.
- **Feishu**: open.feishu.cn/app → create a custom in-house app (use your name) → add the bot capability → permissions: im:message, im:message:send_as_bot, im:chat:readonly → events and callbacks: choose "long connection", add "receive message", "bot added to group", "bot removed from group" → credentials page: harvest the App ID directly; click "view" then harvest the App Secret → **version management and release: create a version → availability must include this user ("everyone" is simplest) → publish, and wait for the admin to approve**. No public address needed.
  - Publishing is not optional: without it the credentials still connect and the console looks fine, but the user cannot find the bot in Feishu at all and no message arrives. That is why step 4 exists.
  - Approval needs a company admin. If the user is the admin, have them approve it under "admin console → app management". If not, tell them who to ask rather than waiting here.
  - Feishu will not let a bot open a conversation with someone who has never talked to it, so "say hello once connected" has to run backwards: during verification **you, as the user**, send the first message to the bot in the web client, and only then can you reply.
- **Slack**: api.slack.com/apps → Create New App → From an app manifest is simplest: it writes the scopes (chat:write, im:history, channels:history, groups:history, app_mentions:read, channels:read, groups:read, users:read), Socket Mode and events (message.im, message.channels, message.groups, app_mention, member_joined_channel, member_left_channel) in one go → Basic Information, generate an App-Level Token (connections:write) → harvest(field=App-Level Token) → Install to Workspace → harvest(field=Bot Token) under OAuth & Permissions. No public address needed.
- **WeCom**: admin console → My Company: harvest(field=Corp ID) → App management → custom app (use your name) → on its page harvest(field=AgentId), click "view" then harvest(field=Secret) → Receive messages → set up API receiving: put the callback URL from info in, generate a random Token and EncodingAESKey and harvest each → put the public IP from info into trusted enterprise IPs → save (it can only verify after the system has connected, so: harvest everything first, let the system connect, then save). A WeCom app cannot join groups; direct messages only.
- **Discord**: discord.com/developers/applications → New Application (use your name) → Bot page, Reset Token then harvest(field=Bot Token) → **turn on Message Content Intent on the Bot page** (without it you receive only the content of messages that @ you, and nothing else) → OAuth2 → URL Generator, tick bot + Send Messages + Read Message History, and give the user the invite link to add you to their server. No public address needed. Direct messages require you and the user to share a server.
- **WhatsApp**: the official Cloud API only (third-party protocols get accounts banned). developers.facebook.com/apps → create a Business app → add the WhatsApp product → the API Setup page has a test number and a Phone number ID (harvest(field=Phone number ID)) → **the token must be a system user's permanent token** (create a system user in Business Manager with whatsapp_business_messaging; the one offered on the page expires in 24 hours) → Webhook takes the callback address and verify string from harvest(info), subscribed to the messages field. Two hard rules to tell the user up front: **the other person must message you first**, and **you can only reply freely inside a 24-hour window** — after that only pre-approved templates. The test number can only message allow-listed numbers; going live needs Meta business verification and their own number. The WhatsApp API has no groups; direct messages only.
- **Lark (Feishu international)**: the same product on a different cloud, console at open.larksuite.com. The credentials look the same and the system works out which cloud to use, so follow the Feishu steps.
- **WeChat**: goes through Tencent's own iLink bot gateway — no console, no credentials, no public address, and not a third-party protocol, so no ban risk. There is exactly one step: build(aspect=channel, action=add, value="WeChat"), the system puts a QR code in the thread, the user scans it with WeChat on their phone, and you are in their WeChat. Do not open the computer, do not go looking for a developer platform, do not harvest (harvest errors out for WeChat). Three hard rules to state first: **direct messages only** (this gateway has no groups), **you can reply but never open** (a reply carries a receipt from the user's last message, so they have to speak first), and **text only for now** (ask them to send images, voice and files from the App). The code lasts a few minutes and the system replaces it automatically; if it is never scanned it lapses and you simply add again.
- **WeCom**: see above — a different thing entirely. It is an in-house app for colleagues inside a company and cannot reach personal WeChat users outside it. "WeChat" means the former by default; "WeCom" means the latter. If it is unclear, ask.

## Route two: the user creates it and fills in the card
build(aspect=channel, action=add, value="Feishu"). The system sends the credential card, with the steps and the fields on it. All you say is "follow the steps on the card to create a bot, and put the credentials on the card". Step 4's verification still applies. When they finish, the system connects it and tells you. If it fails, say why in plain words and have them check and refill: request_credentials with integration set to the platform name (e.g. "Feishu") resends the standard card (the fields are fixed; you do not define them).`,
  },
  {
    name: 'Connecting an external service',
    description:
      'How to connect mail, calendars, Notion, GitHub, files and the rest: send an authorisation card when one-click works, otherwise connect it by hand over MCP.',
    body: `## Purpose
Attach an external service to the user so its abilities become your tools. They do not need to understand OAuth, IMAP, APIs or tokens, and they never paste a credential into the conversation.

## First see whether one click will do it (preferred)
The connect tool does the whole thing: you call it, an authorisation card appears in the thread, the user clicks it, logs in and approves in their browser, and it is connected — the system then wakes you to continue. Several hundred mainstream platforms work this way; service takes the platform's slug:
- Mail / calendar: gmail, googlecalendar, outlook
- Docs / notes / sheets: notion, googledrive, googledocs, googlesheets, dropbox, airtable
- Messaging: slack, lark, discord
- Development / projects: github, linear, jira, trello, asana
- Others: hubspot, twitter, youtube… if you are unsure, try the slug; connect will tell you whether it knows it
When the user mentions one of these and it is not connected, just call connect. Do not ask "which mail provider do you use" or "how would you like to connect it" first. Only when connect says plainly that it does not know the platform do you fall back to the manual route below.

## Principle: end to end
Whenever the user has to do something elsewhere, give them a link they can click and the two or three steps that follow on that page — never just "turn it on in settings". Authorisation goes through a connect card; credentials go through a request_credentials card (with a help link); when it is connected the system says so, and the user never has to come back and report.

## Three steps
1. The user asks for something ("sort my mail", "pull the meeting notes out of our Feishu docs").
2. You work out which platform that needs, and try connect first: if it knows the platform, a card appears and one login connects it.
3. Only if connect says it does not know it do you connect by hand. The order is "build the bridge, then ask for credentials", never the reverse:
   a. Work first: use an existing MCP server if there is one (list below; otherwise search "<platform> MCP server"). If there genuinely is none and you have an external agent, use delegate_agent straight away to have it write a minimal stdio MCP server against that platform's public API — only the one or two endpoints the user needs this time (example: QQ Mail = IMAP receive + SMTP send), reading every credential from an environment variable, written into your own workspace.
   b. Create the connection with build(aspect=mcp, action=add, value={"name":"…","command":"python3 /path/server.py"}). There are no credentials yet, so its status is error. That is expected.
   c. Send a credential card with request_credentials: each field key is the environment variable the bridge reads, the label is plain language, and the hint says where to get it (QQ Mail → Settings › Account › enable IMAP/SMTP → the 16-character app password). The user fills in the card and the values go straight into the connection, never through the conversation.
   d. The system reconnects and tells you: on success, start the work. On failure, decide whether the credential is wrong or the bridge is buggy, and either resend the card or have the agent fix it.
   At no point does the user type a password, an app password or a token into the thread; and do not interrogate them before starting. All they should see is "let me wire that up" → one credential card → "connected". With no external agent available, say honestly that they need to enable Claude Code, Codex, Hermes, OpenCode or OpenClaw under Integrations › External agents.
When connect says the platform is not enabled yet, tell the user plainly that the product cannot reach it for now. Do not walk them into generating an app password or a token instead.

## The manual route: MCP (step 3)
MCP (Model Context Protocol) is the standard for wrapping an external system's abilities as "tools". Connect an MCP server and its tools appear directly in your tool list.
- stdio: start a local process (usually one npx command). Right for filesystems, local databases, anything that needs a login on this machine.
- http: a remote address (starts with https://, usually ends in /mcp). Right for Notion, Linear, GitHub and other officially hosted MCPs; the first call normally goes through their own OAuth.

Flow:
1. Establish what they want connected and what they want you to do with it, and pick the MCP server.
2. If it needs credentials, tell the user where to apply for them. Credentials never go in the thread: for stdio they live in environment variables on the start command, which the user fills in on the Integrations page.
3. Create the connection with build(aspect=mcp, action=add, value={"name":"…","command":"…"}) or value={"name":"…","url":"…"}. The system connects, lists the tool count and grants them to you. Anything already in the pool (findable with library search) should not be hand-written: build(aspect=mcp, action=add, value=slug).
4. Check the status under "your integrations": ok with a tool count means it worked; on error, pass the error to the user verbatim. Tool names are prefixed with the connection name.
5. Have the user say something that uses it, so it gets exercised once for real.

Common MCP servers:
- Local files: npx -y @modelcontextprotocol/server-filesystem <allowed directory>
- GitHub: npx -y @modelcontextprotocol/server-github (needs GITHUB_PERSONAL_ACCESS_TOKEN)
- Notion: officially hosted at https://mcp.notion.com/mcp (http)
- Linear: https://mcp.linear.app/mcp
- Slack read/write: npx -y @modelcontextprotocol/server-slack (needs SLACK_BOT_TOKEN, SLACK_TEAM_ID)
- Browser automation: npx -y @playwright/mcp@latest
- Postgres: npx -y @modelcontextprotocol/server-postgres <connection string>
- Canvas / whiteboard (Excalidraw, tldraw): search "<product> mcp server"; usually one npx line too

## Chinese platforms (none of them are one-click; step 3 only)
Credentials always go through a request_credentials card, with help.url pointing at the direct links below and steps saying what to click once there. The user should not have to hunt through menus.
- Feishu / Lark: app list https://open.feishu.cn/app → create a custom in-house app → App ID and App Secret under "credentials and basic info"; enable the scopes you need under "permissions" (docs docx / drive, calendar, contact…), then publish a version under "version management and release" for it to take effect. Official MCP: npx -y @larksuiteoapi/lark-mcp mcp -a <App ID> -s <App Secret>; it acts as the app by default and only sees documents the app was granted, so reading the user's own documents needs --oauth and one user authorisation (which opens a browser). Feishu as a messenger channel has its own built-in path under Integrations › Channels, using the same App ID / Secret pair.
- DingTalk: developer console https://open-dev.dingtalk.com/fe/app → app development → in-house app → Client ID (formerly AppKey) and Client Secret under credentials; request the API scopes under "permissions". There is no stable official MCP and community ones are patchy; if you cannot find a usable one, write the minimal server per step 3.
- WeCom: admin console apps page https://work.weixin.qq.com/wework_admin/frame#apps → app management → custom app → AgentId and Secret; the Corp ID is at the bottom of "My Company". Trap: API calls require the server's public IP in the app's trusted IP list, and a machine without a fixed public IP gets error 60020. No official MCP.
- QQ Mail / 163 / 126 / company mailboxes: all IMAP + SMTP, and the credential is an "app password", not the login password. QQ: https://mail.qq.com → Settings › Account › enable IMAP/SMTP → SMS verification → a 16-character app password (imap.qq.com:993 / smtp.qq.com:465). 163: https://mail.163.com → Settings › POP3/SMTP/IMAP › enable and add an app password (imap.163.com:993 / smtp.163.com:465). No ready-made MCP: per step 3, have an agent write a few dozen lines of IMAP/SMTP bridge with credential fields MAIL_ADDRESS and MAIL_AUTH_CODE.
- WeChat: as a messenger channel it is built in (build(aspect=channel, action=add, value="WeChat") sends a QR code through Tencent's iLink gateway and scanning connects it) — do not wire it up by hand here. For other WeChat data (official-account console, WeChat Customer Service, payments) there is no ready-made MCP: write one per step 3 and send a credential card.
- Tencent Docs, Yuque, and the like: search "<platform> MCP server" first; usually one npx line plus a token environment variable. Otherwise step 3.

Common errors:
- spawn npx ENOENT: no Node.js / npx on this machine; have the user install Node 22+.
- Timeout or 401/403: the token is missing or expired; have them get a new one and edit the connection under Integrations.
- Zero tools: the server started but has no login; have the user complete that MCP's first-run authorisation.

## Boundaries
- Every connection is the user's own account, with exactly their permissions. Tools that delete, send or pay still go through the act / ask_user rules for your autonomy.
- When you do not know whether a platform has an MCP, say so, and suggest they search "<platform> MCP server".`,
  },
  {
    name: 'Which machine the bots run on',
    description:
      'How to answer and how to help when the user asks "where do the bots run", "move them to the cloud", "bring them back to my computer", "switch machines", "do I still need that machine". The two directions have completely different requirements — never answer one with the other\'s.',
    body: `## Purpose
The bots run on one machine: the user's own computer, or a cloud machine that never sleeps. This is the page at Settings › Cloud computer. When the user asks about it or wants to move, follow this manual.

## Get the direction straight; this is where it goes wrong
**Moving out (this computer → a cloud machine)** needs a machine: Linux, on 24 hours a day, a fixed IP or domain, reachable over ssh. If they do not have one, walk them through getting one (the steward carries the "Setting up a cloud machine" manual).

**Coming home (cloud machine → this computer) requires nothing at all.** No fixed IP, no ssh, no always-on computer — Steadbot running on their computer is the whole requirement, and they are talking to you, which means it is running. When the user says "bring them back to my computer", **do not ask whether their computer is Linux, whether it has a fixed IP, or whether it is a laptop**. Those belong to the other direction. Just tell them: Settings › Cloud computer, press "bring them back" on that machine's row. A few minutes, and the history, memory, skills and workspaces come with them.

There is exactly one cost worth stating, in one sentence: **once they are back on the computer, closing or sleeping it stops the bots**. On a cloud machine they keep going. If what they actually want is "keep going with the laptop shut", they should not move back.

## The machine stays
Once a cloud machine is configured it stays listed on that page, which is a separate thing from where the bots are right now:
- With the bots at home, that machine's row reads "empty" and one press moves them there. No reinstall.
- "Delete" only means this device stops remembering its address and pairing code. **The service on that machine keeps running**, and stopping it for real means stopping it on the machine (or having the steward do it). The cloud provider keeps billing either way.
- Several machines can be configured, one row each; the bots are only ever on one of them.

## Facts worth carrying
- Model keys follow the machine that does the work: a move takes the configuration along, so nothing needs re-entering afterwards.
- External agents (Claude Code and friends) only ever live on the user's own computer; a bot in the cloud borrows them. When the computer is off they are unavailable, and that has nothing to do with moving.
- Do not let the user close the window mid-move; when it finishes the App switches over by itself.`,
  },
  {
    name: 'Connecting an external agent',
    description:
      'How to connect Claude Code, Codex, Hermes, OpenCode or OpenClaw and grant it to a bot, when the user wants the bot to write code, run scripts, process files in bulk or do deep research.',
    body: `## Purpose
Turn an external agent into one of your tools. You hand it a whole task with delegate_agent, it runs inside your own workspace, and you get the result back. Five are supported: Claude Code, Codex, Hermes, OpenCode, OpenClaw.

## Two ways to connect (the product picks; ACP preferred)
- ACP: the way an editor connects an agent. The user sees every tool the agent calls; running a command, deleting a file or touching anything outside the workspace turns into a card for them to approve; the session persists, so a follow-up task continues from the last one. Hermes, OpenCode and OpenClaw speak ACP natively; Claude Code and Codex connect through the adapters Zed maintains (npx is enough; the first run downloads them).
- One-shot: the fallback when the machine has the CLI but no ACP. One process per task, final output only.
Each row under Integrations › External agents says which one it is on.

## When to use this
The user says "make you able to write code", "run a script for me", "change a pile of files", "dig into this project", "connect Claude Code / Codex / Hermes".

## Flow
1. Look at "external agents" under "your integrations" in the system prompt: ok means it is installed on this machine, off means the command is not there.
2. For what is not installed, walk the user through installing and logging in below, then have them press "check again" on the Integrations page, or just tell you, and you confirm it has turned ok.
3. build(aspect=agent, action=add, value="Claude Code") to make it yours.
4. From then on delegate_agent works. Have the user name a concrete task to try it, like "merge the csvs in the workspace into one table".

## Installing and logging in
- Claude Code: npm install -g @anthropic-ai/claude-code; run claude in a terminal and follow the prompts (or set ANTHROPIC_API_KEY); verify with claude -p "say hi".
- Codex: npm install -g @openai/codex; codex login in a terminal; verify with codex exec "say hi".
- Hermes: install per its docs, then hermes setup to configure a model; verify with hermes chat -q "say hi" --oneshot.
- OpenCode: npm install -g opencode-ai; opencode auth login; verify with opencode run "say hi".
- OpenClaw: npm install -g openclaw; openclaw login; verify with openclaw agent --local -m "say hi".
- Custom: anything that takes a task on the command line and prints a result can be connected. Add an agent under Integrations, give the command and arguments, and the task text is passed as the last argument.

## When the bots are on a cloud machine: borrowing the agents on the user's computer
An agent and its login live only on the user's computer and are never copied to the cloud. While Steadbot is running there, that computer connects to the cloud machine and lends its agents to the bots: the task is executed on the computer, your workspace goes over first and the files the agent writes come back, and permission prompts still follow your autonomy and the user's cards.
- A row under Integrations › External agents that reads "installed on your computer · called through it" is one of these; the runtime page shows whether the computer is online.
- Computer off, asleep, or Steadbot not running on it: those agents are unavailable for now and everything else carries on. When the user asks why, that one sentence is the answer — have them start Steadbot on their computer (type steadbot in a terminal). No reinstall, no moving home.
- To add a new agent, install it on the computer, then press "check again" on that row.

## How permissions are decided
Under ACP the agent asks before each action. The product answers on your behalf: reading, searching and fetching pages are always allowed; editing files inside the workspace is allowed; running commands, deleting files and touching anything outside the workspace follow your autonomy — "just do it" allows them, anything else raises a card for the user, who can choose "allow, and stop asking".

## How to hand over a task
- The description has to stand alone: the goal, where the input is, what you expect back, the constraints. The agent cannot see your conversation.
- Hand over one whole task and wait for the result before deciding the next step. A follow-up is simply another handover and continues the same session; to start clean use fresh=true.
- When the result includes files, tell the user they are in that bot's workspace (~/.crew/bots/<botId>/workspace).
- If the agent says it is not logged in, pass its own instructions to the user verbatim. Do not go and edit its configuration yourself.`,
  },
];

/** The steward's manual: where to get a machine that stays on, what to pick, where the IP / password / firewall live. Only the steward carries it. */
export const STEWARD_SKILL: { name: string; description: string; body: string } = {
  name: 'Setting up a cloud machine',
  description:
    "The steward's operations manual: how to get the user a Linux machine that stays on, install the service on it, diagnose and fix the usual problems (network, mirrors, MTU, firewall, Docker), and move the bots over.",
  body: `## Purpose
The user's bots currently run on their own computer, and stop when it does. Staying online needs a Linux machine that does not shut down. This is your operations manual: act first, read the output, then decide the next step, and only put work on the user where a person is genuinely required.

## 1. Getting a machine
- No machine, wants the easy path: Tencent Cloud Lighthouse https://cloud.tencent.com/product/lighthouse. Create from an OS image, Ubuntu 22.04; region: Hong Kong or an overseas node if the models are overseas or a domain is wanted, otherwise whatever is closest to the user; 2 vCPU / 4 GB; login method "custom password". After purchase the instance card shows the public IP; the username is ubuntu, and a forgotten password is reset on the instance page.
- Alibaba Cloud Simple Application Server https://www.aliyun.com/product/swas: instance type "general" (not the agent-specific one), image Ubuntu 22.04, 2 vCPU / 4 GB; username root, set a password with "reset password".
- Their own machine: Linux (Ubuntu or Debian), on 24 hours, fixed IP, reachable over ssh. Usually root.
- Nothing needs installing in advance.

## 2. Connecting
machine_card(stage=connect). Once they fill it in and it connects, the system hands you a health report (OS, CPU, memory, disk, Docker, NIC MTU, sudo, whether GitHub and Docker Hub are reachable, whether it has been installed before). Read it:
- Memory < 2 GB: installable, but add swap (see remedies).
- Free disk < 5 GB: clean up first (apt clean, docker system prune) or have them use a bigger machine.
- GitHub unreachable: the skill library cannot be fetched during the build, so it ends up without the bundled pool. Not fatal. Docker Hub unreachable: base images cannot be pulled and a mirror is needed (see remedies).
- Already installed: go straight to machine_pair, and if it answers, send the move card.
Why connections fail, usually: wrong username or password (ubuntu on Tencent, root on Alibaba; reset it in the console); a mistyped IP or a machine that is not up yet (wait a minute); port 22 blocked by a firewall (cloud providers open it by default; their own machine is their own problem).

## 3. The standard install
1. machine_probe: see whether large packets get through.
2. Adjust the MTU if needed (command under remedies), and pass CREW_MTU=1300 to the installer in step 4.
3. machine_upload.
4. machine_ssh: sudo env CREW_MTU=1300 bash /opt/crew/crew-server/deploy/install.sh (drop CREW_MTU when it is not needed). Give timeout_s 1500. It installs Docker if missing, builds the image, starts the service and writes the pairing details. Check the end of the output for CREW_INSTALL_OK.
5. machine_pair: read the address back and test it from outside.
6. Port unreachable → have the user add a firewall rule in the cloud console (TCP, port 5200, any source). Only they can do this. Re-check with machine_probe afterwards.
7. Reachable → machine_card(stage=move). Once they press it the App switches to that machine and you carry on over there.

For anything that takes minutes and can go wrong halfway — the install script, the Docker build — use vigil: start the command in the background (machine_ssh with >/tmp/install.log 2>&1 & or nohup), then vigil(action=start, goal='get the service installed', watching='install log and service health', check_kind=machine, check_command='tail -n 30 /tmp/install.log; echo ---; curl -s -o /dev/null -w %{http_code} http://127.0.0.1:5200/health', every_s=30). The system only wakes you when the log changes or health looks wrong; you glance, fix if needed, and when it is up you machine_pair and vigil(action=stop). That way a long install never blocks you.

## 4. Remedies (what you see, what you do)
- Upload stalls, or the first chunk never lands, or machine_probe reports an MTU black hole: on the machine, run
  sudo ip link set dev "$(ip route show default | awk '/default/{print $5; exit}')" mtu 1300
  then retry the upload, and pass CREW_MTU=1300 to the installer so the setting is made permanent and the container uses 1300 too (otherwise the App's direct connection stalls after the move).
- Docker install fails / get.docker.com times out (common in mainland regions): curl -fsSL https://get.docker.com | sudo sh -s -- --mirror Aliyun, or sudo apt-get install -y docker.io docker-compose-plugin.
- docker pull slow or failing (Docker Hub unreachable): write "registry-mirrors": ["https://docker.m.daocloud.io","https://dockerproxy.com"] into /etc/docker/daemon.json (keep existing keys like mtu; merge with python3), sudo systemctl restart docker, then re-run the installer.
- apt slow: replace archive.ubuntu.com with mirrors.aliyun.com in /etc/apt/sources.list (sed -i), then apt-get update.
- Out of memory (killed during the build, OOM): add 2 GB of swap with sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab.
- Disk full: sudo apt-get clean; sudo docker system prune -af. If that is not enough, have them attach a bigger disk.
- Port 5200 taken: ss -ltnp to see by what; if it is an old crew container, docker compose -f /opt/crew/crew-server/deploy/docker-compose.yml down and install again.
- Container up but health failing (curl -s localhost:5200/health on the machine does not return {"ok":true}): docker compose -f /opt/crew/crew-server/deploy/docker-compose.yml logs --tail 100 crew. Usually the model key did not come across (a move brings it; a fresh install with nothing is normal) or a port conflict.
- "Needs administrator privileges / sudo failed": have them use root or an account with sudo, and send a fresh connection card.
- Command timed out: work out whether it is stuck on the network (a download) or deadlocked; a network problem means a mirror, a deadlock means kill and re-run.
- Same problem twice without fixing it: stop. Tell the user in a sentence or two what you are seeing and what you think, and give two options (retry, or buy again in a different region).

## 5. How to talk to the user
- Do not report every step of the install; they can see the commands and output on the card. Speak when it is done, when it is stuck, or when you need them (open the firewall, change machine, re-enter the password).
- One thing at a time, in plain words. No logs, no commands for them to type, no explaining what "MTU" or "Docker" is unless they ask.
- Facts for after the move: it no longer matters if their computer shuts down, and the history, memory, skills and workspaces all went over.

## 6. Coming home, and what happens to the machine
This section is the other direction, with completely different requirements. Never answer it with section 1's.
- **Coming home requires nothing**: no fixed IP, no ssh, no always-on computer. Steadbot running on their computer is enough. Have them press "bring them back" on that machine's row under Settings › Cloud computer, or just tell them that sentence.
- When the user says "bring them back to my computer", **do not ask whether their computer is Linux or has a fixed IP** — that is the outbound direction. The one cost worth stating: with the bots at home, closing the computer stops them.
- A configured machine stays on that page: with the bots at home its row reads "empty", and one press sends them back without reinstalling.
- "Delete" on that row only stops this device from remembering its address and pairing code. The service on the machine keeps running and the provider keeps billing. When the user says they are done with a machine, find out which they mean; stopping the service for real is docker compose -f /opt/crew/crew-server/deploy/docker-compose.yml down on the machine.`,
};

/** Built-in manuals belong to the product: they are (re)written at every start so improvements ship. */
export function seedBuiltinSkills(skills: SkillStore) {
  for (const s of [...BUILTIN_SKILLS, STEWARD_SKILL]) {
    const cur = skills.get(s.name);
    if (!cur || cur.body.trim() !== s.body.trim() || cur.description !== s.description) skills.write(s.name, s.description, s.body);
    // The dependency scanner may have changed since the manual was last written; what it thinks is missing is shown to bots and users.
    else skills.refreshRequires(s.name);
  }
}

export const BUILTIN_SKILL_NAMES = BUILTIN_SKILLS.map((s) => s.name);
