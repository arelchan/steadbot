/**
 * 领域类型和协议来自 crew-server/src/shared/——前后端同一份。以前这里是手写的第二份，
 * 661 行对 665 行，已经漂过：Card 那边 9 种这边 7 种。
 * 这个文件现在只放界面自己的东西：面板、布局、选中了谁、本地那份 State。
 */
export * from '@shared/types.ts';
export * from '@shared/wire.ts';

import type { Autonomy, Bot, Toast as WireToast, CrewEvent, Integration, Matter, Message, Pending, Action, SkillDoc, LibraryEntry, ThreadId, Todo, CrewSettings, Computer, ModelsPage, UsageReport, RuntimeInfo } from '@shared/types.ts';

export const AUTONOMY_LABEL: Record<Autonomy, string> = {
  tell: '只告诉我',
  prepare: '备好等我点',
  do: '直接办',
};

/** Library categories the backend tags skills with; their names live in the language catalogs (`lib.<id>`). */
export const LIBRARY_CATEGORY_IDS = ['dev', 'docs', 'writing', 'research', 'productivity', 'business', 'design', 'meta'];

export type Selection = ThreadId | 'week' | 'inbox' | 'profile' | 'draft-bot' | 'runtime';

export type Panel = { mode: 'board' } | { mode: 'task'; todoId: string };

export interface Panels { identity: boolean; tasks: boolean }

/** Column widths in px, user-draggable: bot list / 事项 column / 身份 column. */
export interface Layout { sidebar: number; side: number; right: number }

export const DEFAULT_LAYOUT: Layout = { sidebar: 252, side: 316, right: 312 };

export const LAYOUT_LIMITS: Record<keyof Layout, [number, number]> = { sidebar: [200, 400], side: [260, 480], right: [260, 480] };

/** 升级 as the whole App sees it: which of the four slow things is happening, and what the machine last printed. */
export type UpgradePhase = 'fetch' | 'wait' | 'apply' | 'back' | 'done' | 'error';

export interface UpgradeRun {
  /** the version being installed, when it is known */
  to?: string;
  phase: UpgradePhase;
  line: string;
  lines: string[];
  startedAt: number;
  err?: string;
}

/**
 * 界面上那张卡片。服务端发过来的 toast 只是载荷（谁、说了什么、哪条线），
 * 排队、去重、七秒后消失是界面的事，所以 id 和 ts 加在这边。
 */
export interface ToastItem extends WireToast {
  id: string;
  ts: number;
}

export interface State {
  /** 设置 › 模型 and 设置 › 用量, pushed by the server over the socket. Never persisted: what they say has to be
   *  current or absent, so a new window shows a skeleton until this connection's own answer arrives. */
  models?: ModelsPage;
  usage?: UsageReport;
  /** an upgrade in progress: while this is set the App is behind a curtain (UpgradeCurtain.tsx).
   *  Not `upgrade`: the snapshot already carries that name, for the machine's version status. */
  upgrading?: UpgradeRun;
  /** the server this page is connected to (undefined until the first snapshot) */
  runtime?: RuntimeInfo;
  settings?: CrewSettings;
  /** the bots' shared computer; absent on a runtime that cannot host one */
  computer?: Computer;
  bots: Bot[];
  matters: Matter[];
  todos: Todo[];
  events: CrewEvent[];
  pendings: Pending[];
  actions: Action[];
  messages: Message[];
  sharedProfile: string[];
  skills: SkillDoc[];
  library: LibraryEntry[];
  integrations: Integration[];
  selection: Selection;
  toasts: ToastItem[];
  typing: Record<string, string[]>; // threadId -> botIds typing
  lastSeen: Record<string, number>; // threadId -> ts
  panel: Panel;
  panels: Panels;
  layout: Layout;
  focusMessageId?: string;
  /** live backend connection state */
  online?: boolean;
  /** The server has no model configured, so no bot can take a turn until one is added. */
  needsModel?: boolean;
}
