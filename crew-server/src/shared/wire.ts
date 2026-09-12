/**
 * 前后端之间说的话。以前这东西有四份：服务端的 ServerMessage、前端 ws-agent 里内联的一份、
 * store.ts 的 StoreEvent（靠一个 as 硬转接上）、还有 upgrade.ts 另开一条 socket 自己手写的。
 * 而客户端发出去那条线压根没有类型——send(o: object)，35 种消息全靠字面量拼。
 *
 * 现在只有这一份。两边的 switch 都要有 never 收尾，加一种消息就会在没接的那头报错。
 */
import type { Action, Bot, Channel, Computer, CrewEvent, CrewSettings, FileRef, Integration, LibraryEntry, Matter, Message, Pending, RuntimeInfo, SkillDoc, ModelsPage, ThreadId, Toast, Todo, UpgradeStatus, UsageReport } from './types.ts';

export interface Snapshot {
  runtime?: RuntimeInfo;
  settings?: CrewSettings;
  /** the shared computer's state; absent on a runtime that cannot host one */
  computer?: Computer;
  bots: Bot[];
  matters: Matter[];
  todos: Todo[];
  /** 日程上我们自己排的事（例行任务不在这里，它长在 bot 身上） */
  events: CrewEvent[];
  pendings: Pending[];
  actions: Action[];
  messages: Message[];
  sharedProfile: string[];
  skills?: SkillDoc[];
  library?: LibraryEntry[];
  /** threadId -> bot ids currently mid-turn (ephemeral, not persisted) */
  typing?: Record<string, string[]>;
  /** 升级状态：这台电脑上的代码 vs 正在跑的代码 */
  upgrade?: UpgradeStatus;
  integrations: Integration[];
}

/* ---------------- wire protocol ---------------- */

export type ClientMessage =
  /** 往上翻：这条线在 before 之前还有没有更早的。首屏只给最近若干条（ws 地址里的 recent）。 */
  | { type: 'load_more'; threadId: ThreadId; before: number; limit?: number }
  | { type: 'user_message'; id?: string; threadId: ThreadId; text: string; via?: Channel; files?: FileRef[] }
  | { type: 'migrate_to'; url: string; token: string; force?: boolean }
  | { type: 'remote_install'; host: string; user: string; password?: string; domain?: string }
  | { type: 'migrate_from'; url: string; token: string }
  /** 叫管家出来：确保管家 bot 存在，并替用户发出第一句话 */
  | { type: 'steward'; intent: 'move_out' }
  /** 连接卡提交：本机 ssh 连上那台机器，密码存进本机凭据，体检结果写回卡片并告知管家 */
  | { type: 'machine_connect'; messageId: string; host: string; user: string; password?: string; port?: number }
  /** 机器卡（move）点了「搬过去」 */
  | { type: 'machine_move'; messageId: string }
  | { type: 'draft_message'; id?: string; text: string }
  | { type: 'pending_choice'; pendingId: string; optionId: string }
  | { type: 'patch_bot'; id: string; patch: Partial<Bot> }
  /** 例行任务的「试跑」：不等到点，现在就让它跑一次 */
  | { type: 'run_routine'; botId: string; routineId: string }
  /** 用户在日程上把 bot 排的这条撤掉 */
  | { type: 'drop_event'; id: string }
  | { type: 'patch_matter'; id: string; patch: Partial<Matter> }
  | { type: 'create_matter'; id?: string; title: string; summary?: string; memberIds: string[]; leadId: string }
  | { type: 'set_shared_profile'; lines: string[] }
  | { type: 'undo_action'; actionId: string }
  | { type: 'avatar'; botId: string; op: 'regen' | 'reset' | 'upload'; dataUrl?: string }
  | { type: 'delete_bot'; id: string }
  | { type: 'delete_matter'; id: string }
  | { type: 'patch_skill'; botId: string; name: string; patch: { description?: string; body?: string } }
  | { type: 'mount_library_skill'; botId: string; slug: string }
  | { type: 'submit_secrets'; messageId: string; integrationId: string; values: Record<string, string> }
  | { type: 'submit_login'; messageId: string; askId: string; values: Record<string, string> }
  /** 把一个 bot 接到某个 IM：在它的会话里发一张凭据卡（它在那个 IM 里是独立的机器人，凭据只进 config.json） */
  | { type: 'connect_channel'; botId: string; channel: Channel }
  /** 断开一个 bot 在某个 IM 上的账号：停桥、删凭据 */
  | { type: 'disconnect_channel'; botId: string; channel: Channel }
  /** 给 bot 的电脑开机 / 关机 */
  | { type: 'computer_power'; on: boolean }
  | { type: 'computer_focus' }
  /** 升级到这台电脑上的最新代码（bot 在云机器上时，连那台一起升） */
  | { type: 'upgrade' }
  | { type: 'usage'; days?: number }
  | { type: 'set_settings'; patch: CrewSettings }
  | { type: 'add_integration'; integration: Pick<Integration, 'kind' | 'name' | 'transport' | 'command' | 'args' | 'url' | 'env' | 'agent' | 'agentArgs'> & { id?: string } }
  | { type: 'patch_integration'; id: string; patch: Partial<Integration> }
  | { type: 'remove_integration'; id: string }
  | { type: 'test_integration'; id: string }
  | { type: 'clear_thread'; threadId: ThreadId };

export type ServerMessage =
  | { type: 'migrated'; direction: 'to' | 'from'; url: string; bots?: number }
  | { type: 'migrate_progress'; sent: number; total: number }
  | { type: 'steward'; botId: string }
  /** bot 们已搬走：客户端切到那台机器（带上它的连接凭据）并刷新 */
  | { type: 'switch_runtime'; url: string; token: string; name?: string }
  | { type: 'remote_install_log'; line: string }
  | { type: 'remote_install_done'; code?: string; url?: string; error?: string }
  | { type: 'runtime'; runtime: RuntimeInfo }
  | { type: 'upgrade_status'; status: UpgradeStatus }
  | { type: 'upgrade_log'; line: string }
  | { type: 'upgrade_done'; error?: string; restarting?: boolean }
  | { type: 'usage'; report: UsageReport }
  | { type: 'models'; page: ModelsPage }
  | { type: 'snapshot'; state: Snapshot; mode: 'live' | 'fake' }
  | { type: 'message'; message: Message }
  | { type: 'message_patch'; id: string; patch: Partial<Message> }
  | { type: 'typing'; threadId: ThreadId; botId: string; on: boolean }
  | { type: 'todo'; todo: Todo }
  | { type: 'event'; event: CrewEvent }
  | { type: 'event_deleted'; id: string }
  | { type: 'computer'; computer: Computer }
  | { type: 'pending'; pending: Pending }
  | { type: 'action'; action: Action }
  | { type: 'bot'; bot: Bot }
  | { type: 'matter'; matter: Matter }
  | { type: 'shared_profile'; lines: string[] }
  | { type: 'settings'; settings: CrewSettings }
  | { type: 'toast'; toast: Toast }
  | { type: 'bot_created'; bot: Bot; draftId?: string }
  | { type: 'bot_deleted'; id: string }
  | { type: 'matter_deleted'; id: string }
  | { type: 'skill'; skill: SkillDoc }
  | { type: 'integration'; integration: Integration }
  | { type: 'integration_deleted'; id: string }
  | { type: 'thread_cleared'; threadId: ThreadId }
  /** 往上翻的结果。more=false 表示到头了，别再问。 */
  | { type: 'more_messages'; threadId: ThreadId; messages: Message[]; more: boolean }
  | { type: 'error'; error: string };
