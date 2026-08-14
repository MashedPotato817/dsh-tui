/**
 * dsh-tui 核心库类型声明（core 层，零依赖）。
 * 对齐官方 @deepseek-ai/* 插件规范：main + types + exports（具名子路径）。
 * 仅声明，不引入任何运行时 / Node 依赖，供 VSCode / TS 项目复用 core API。
 * @module dsh-tui
 */

// ---------- fold ----------
export interface FoldedMessage {
  role: "user" | "assistant";
  seq: number;
  time?: number | null;
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number } | null;
  injected?: boolean;
}
export interface FoldedTool {
  seq: number;
  callId?: string;
  name: string;
  args: string;
  status: "running" | "done" | "error";
  startedAt?: number | null;
  finishedAt?: number | null;
  diffMeta?: unknown;
}
export interface LastTurnEnd {
  turn: number;
  reason: unknown | null;
  seq?: number;
}
export interface FoldedView {
  messages: FoldedMessage[];
  tools: FoldedTool[];
  turn: number;
  lastTurnEnd: LastTurnEnd | null;
  turnStartTime: number | null;
  lastSeq: number;
  model: string | null;
  contextWindow: number | null;
}
export function foldEvents(entries?: Array<object>): FoldedView;
export function lastAssistantText(view: FoldedView | null): string | null;

// ---------- session ----------
export const PTC_PRESET: string;
export interface SessionMeta {
  agentPreset?: string | null;
  cwd?: string | null;
}
export interface HistoryPage {
  events: Array<object>;
  nextBeforeSeq?: number | null;
}
export class Session {
  client: unknown;
  sessionId: string;
  agentPreset: string | null;
  cwd: string | null;
  constructor(client: unknown, sessionId: string, meta?: SessionMeta);
  static create(client: unknown, opts?: SessionMeta): Promise<Session>;
  static open(client: unknown, id: string): Promise<Session>;
  static openRecent(client: unknown): Promise<Session | null>;
  static list(client: unknown): Promise<Array<{ sessionId: string; running?: boolean; agentPreset?: string; blank?: boolean }>>;
  history(opts?: { beforeSeq?: number; maxMessages?: number }): Promise<HistoryPage>;
  prompt(text: string, opts?: { mode?: "queue" }): Promise<unknown>;
  converse(text: string, opts?: { timeoutMs?: number; pollMs?: number }): Promise<string | null>;
}

// ---------- client ----------
export class DshClient {
  constructor(baseUrl?: string);
  baseUrl: string;
  request<T = unknown>(method: string, payload?: object): Promise<T>;
  respond(rpcId: string, result: object): Promise<{ accepted: boolean; reason?: string }>;
}
export function mintRpcId(): string;

// ---------- stream ----------
export class MuxStream {
  constructor(client: DshClient, sessionId: string);
  frames(opts?: { signal?: AbortSignal }): AsyncGenerator<{ rpcId?: string; payload: unknown }>;
}
export function respond(client: DshClient, rpcId: string, result: object): Promise<unknown>;
export function extractSseData(line: string): string | null;
export function parseServerRequest(data: string): unknown | null;

// ---------- live ----------
export function initialState(): LiveState;
export interface LiveState {
  messages: FoldedMessage[];
  tools: FoldedTool[];
  turn: number;
  lastTurnEnd: LastTurnEnd | null;
  turnStartTime: number | null;
  lastSeq: number;
  streaming: { text?: string; usage?: object } | null;
  running: boolean;
  model: string | null;
  contextWindow: number | null;
  pendingQuestions: Array<unknown>;
  pendingApprovals: Array<{ approvalId?: string; toolName?: string }>;
  permissionMode: string;
  queue: Array<unknown>;
  jobs: Array<unknown>;
  subagents: Array<{ sessionId: string; running?: boolean; summary?: string }>;
  notice: string | null;
  reconnecting: { n: number; max: number } | null;
  connected: boolean;
  error: string | null;
}
export class LiveConversation {
  constructor(deps: {
    client: DshClient;
    session: Session;
    stream?: MuxStream;
    onState?: (state: LiveState) => void;
    policy?: {
      editableTools?: Array<string>;
      allowTools?: Array<string>;
      questions?: Record<string, unknown>;
    } | null;
    approvalMode?: string;
  });
  state: LiveState;
  permissionMode: string;
  onState?: (state: LiveState) => void;
  snapshot(): LiveState;
  emit(): void;
  open(): Promise<void>;
  close(): void;
  send(text: string): Promise<unknown>;
  cancelTurn(): Promise<void>;
  answerApproval(approval: object, outcome: string): Promise<void>;
  answerQuestion(q: object, answers: Array<{ id: string; selected: Array<string> }>): Promise<void>;
  switchSession(session: Session): Promise<void>;
  setPermissionMode(mode: string): string;
  startHistorySync(intervalMs?: number): void;
  resolveStuckPending(stuckAfterMs?: number): void;
  refreshHistory(): Promise<boolean>;
  refreshSubagents?(): Promise<void>;
}
export function mergeToolsByCallId(existing?: Array<FoldedTool>, incoming?: Array<Partial<FoldedTool>>): Array<FoldedTool>;

// ---------- vim ----------
export const MODES: { NORMAL: string; INSERT: string };
export function createVim(): VimState;
export interface VimState {
  mode: string;
  lines: Array<string>;
  cursor: { row: number; col: number };
  pending: string;
}
export function vimKey(prev: VimState, key: string): { state: VimState; action: "none" | "submit" | "run-command"; command?: string };
export function submitText(state: VimState): string;

// ---------- bridge ----------
export function keyToVimKey(key: object): string | null;
export function inputToKeys(input: string, key: object): Array<string>;
export function processInput(state: VimState, input: string, key: object): { state: VimState; action?: "submit" | "run-command"; command?: string };

// ---------- hud ----------
export function hudState(input: {
  view: FoldedView & { streaming?: object };
  session: { sessionId?: string; agentPreset?: string; cwd?: string };
  prices?: Record<string, { input: number; output: number; cacheRead?: number }>;
  now?: number;
}): HudState;
export interface HudState {
  model: string | null;
  modelLabel: string;
  mode: string;
  permBadge: string;
  permColor: string;
  cwd: string;
  running: boolean;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  hasUsage: boolean;
  contextPct: number | null;
  costUsd: number | null;
  sessionId: string;
  turnElapsedLabel: string;
  contextWindow: number | null;
}
export function sumUsage(messages: Array<{ usage?: object }>, streaming?: { usage?: object }): { input: number; output: number; cacheRead: number; cacheWrite: number };
export function priceFor(model: string | null, prices?: Record<string, object>): object | null;
export function costUsd(usage: object, price: object | null): number | null;
export function formatCost(usd: number | null): string | null;
export function formatDuration(ms: number | null): string | null;
export function formatTokens(n: number): string;
export function turnElapsedLabel(startedAtMs: number | null, nowMs: number): string;
export function contextWindowLabel(model: string | null, contextWindow: number | null): string;
export function toolDurationLabel(start: number | null, end: number | null): string | null;
export const DEFAULT_PRICES: Record<string, { input: number; output: number; cacheRead?: number }>;

// ---------- slash ----------
export function commandGroup(name: string): { name: string; scope?: string };
export function filterCommands(input: string, commands: Array<object>): Array<object>;
export function buildSlashPanel(input: string, commands: Array<object>, opts?: { active?: number }): { items: Array<{ name: string; description?: string }>; active: number } | null;
export const BUILTIN_COMMANDS: Array<object>;

// ---------- commands ----------
export function parseSlash(text: string): { name: string; args?: string } | null;
export function routeSlash(cmd: string): { local: boolean; name: string; args?: string } | null;
export function isLocalCommand(name: string): boolean;
export function allCommands(): Array<{ name: string; description?: string; local?: boolean }>;
export const LOCAL_COMMANDS: Array<object>;

// ---------- policy ----------
export interface Question { id: string; options?: Array<{ label: string }>; intent?: { kind: string; approve?: string } }
export interface QuestionAnswerSet { sessionId: string; answer: { answers: Array<{ id: string; selected: Array<string> }> } }
export function answerQuestions(sessionId: string, questions: Array<Question>, policy?: object): QuestionAnswerSet;
export function answerApproval(sessionId: string, approval: { approvalId?: string; toolName?: string }, policy?: object): { sessionId: string; approvalId?: string; outcome: string };
export function hasPlanReview(questions: Array<unknown> | null | undefined): boolean;
export function declinePlan(sessionId: string, questions: Array<Question>): QuestionAnswerSet;

// ---------- registry ----------
export interface RecentMeta { sessionId: string; cwd?: string; agentPreset?: string; recordedAt?: number }
export function readRecent(): RecentMeta | null;
export function writeRecent(sessionId: string, meta?: { cwd?: string; agentPreset?: string; recordedAt?: number }): void;
export function clearRecent(): void;

// ---------- permission ----------
export const PERMISSION_MODES: Record<string, string>;
export function parseMode(mode: string): string;
export function nextMode(mode: string): string;
export function allowToolsForMode(mode: string): Array<string>;
export function shouldDeclinePlanReview(mode: string): boolean;
export function modeBadge(mode: string): string;
export function modeColor(mode: string): string;

// ---------- command-loader ----------
export interface CustomCommand { name: string; description?: string; body?: string; source: string }
export function parseFrontmatter(text: string): { description?: string; [key: string]: unknown };
export function listCommandsFromDir(dir: string, opts?: { source?: string }): Array<CustomCommand>;
export function loadCustomCommands(opts?: { cwd?: string; home?: string; projectDir?: string }): Array<CustomCommand>;

// ---------- config ----------
export interface RuntimeConfig {
  approvalMode: string;
  permissionMode: string;
  editableTools?: Array<string>;
  allowTools?: Array<string>;
}
export function defaultConfig(): object;
export function parseConfig(text: string): object | null;
export function loadConfig(filePath?: string, opts?: object): object;
export function configToRuntime(cfg?: object): RuntimeConfig;

// ---------- history ----------
export function createHistory(): object;
export function pushHistory(hist: object, text: string): object;
export function navigateHistory(hist: object, dir: "up" | "down", current: string): { history: object; text: string | null };

// ---------- diff ----------
export function diffLinesFrom(meta: unknown): Array<string>;
export function classifyDiffLines(lines: Array<string>): Array<{ tag: string; text: string }>;
export function diffStats(lines: Array<string>): { add: number; del: number };
export function diffSummary(stats: { add: number; del: number }): string;
export function guardDiff(lines: Array<string>, opts?: { maxLines?: number; maxAddDel?: number }): { ok: boolean; reason?: "too_many_lines" | "too_many_changes"; add: number; del: number };

// ---------- ui-mode ----------
export const UI_MODES: Record<string, string>;
export function deriveMode(state: object, opts?: object): string;
export function modeLabel(mode: string): string;

// ---------- docs ----------
export const DOC_NAMES: Array<string>;
export function countProjectDocs(filenames?: Array<string>): number;
export function projectDocsLabel(filenames?: Array<string>): string;

// ---------- version ----------
export function resolveVersion(pkgJson: object | null, fallback?: string): string;

// ---------- mention ----------
export type IntentKind = "shell" | "mention" | "slash" | "text";
export interface Intent { kind: IntentKind; rest: string; }
export function detectIntent(text: string): Intent;
export function parseLineRange(mention: string): { file: string | null; start: number | null; end: number | null } | null;
export function buildMentionCandidates(mentionSoFar: string, files?: Array<string>, limit?: number): Array<{ file: string; score: number; isDir?: boolean }>;
export function mentionDisplay(c: { file: string }): string;
export function parseMentionQuery(mentionSoFar: string): { q: string; quoted: boolean };
export function mentionRef(file: string): string;

// ---------- tool-summary ----------
export function toolSummary(tool: { name?: string; args?: string }, limit?: number): string;

// ---------- markdown ----------
export type MarkdownBlock =
  | { type: "text"; content: string }
  | { type: "code"; lang: string; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "list"; ordered: boolean; items: Array<string> }
  | { type: "diff"; content: string };
export function parseMarkdown(text: string): Array<MarkdownBlock>;
export type InlineFragment = { kind: "text" | "bold" | "code"; content: string };
export function inlineFragments(text: string): Array<InlineFragment>;

// ---------- viewport ----------
export function displayWidth(text: string): number;
export function wrapLines(text: string, columns: number): number;
export function estimateMessageRows(msg: { role?: string; text?: string }, columns: number, opts?: { userIndent?: number }): number;
export function tailWithinBudget(messages: Array<{ text?: string; role?: string }>, budget: number, columns: number): { start: number; lines: number };
export function messageBudget(terminalRows: number, fixed?: object): number;

// ---------- safety ----------
export function sanitizeControlChars(text: string): string;
export function hasControlChars(text: string | null): boolean;
export function safeSingleLine(text: string, max?: number): string;

// ---------- timing ----------
export interface TimingAccumulator { scanned: number; buckets: { thinking: number; responding: number; tools: number }; active: { phase: string; start: number } | null }
export function createTimingAccumulator(): TimingAccumulator;
export function advanceTiming(acc: TimingAccumulator, events: Array<{ phase: string | null; at: number }>): { thinking: number; responding: number; tools: number };
export function formatDurationMs(ms: number): string | null;
export function timingSummary(buckets: { thinking?: number; responding?: number; tools?: number }): string;

// ---------- scan ----------
export function scanWorkspace(listDir: (dir: string) => { files: Array<string>; dirs: Array<string> }, opts?: { maxEntries?: number; maxDepth?: number; rootPrefix?: string }): { files: Array<string>; dirs: Array<string> };
export function mentionScanEntries(scan: { files: Array<string>; dirs: Array<string> }): Array<string>;
