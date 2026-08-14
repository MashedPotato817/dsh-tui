// test/types-consumer.ts —— 真实 TypeScript 消费者，对公开 API 做编译期类型校验。
// 由 `npm run check:types` 用 tsc --noEmit 执行；若声明与实现脱节，这里编译失败。
// 这是 Codex 评审第 1 条建议的落地：让 .d.ts 不只被正则抽查，而是被真实使用验证。
import {
  foldEvents,
  lastAssistantText,
  Session,
  DshClient,
  MuxStream,
  LiveConversation,
  initialState,
  createVim,
  submitText,
  vimKey,
  processInput,
  hudState,
  formatTokens,
  buildSlashPanel,
  parseSlash,
  routeSlash,
  allCommands,
  parseMode,
  nextMode,
  modeBadge,
  countProjectDocs,
  projectDocsLabel,
  resolveVersion,
  detectIntent,
  parseLineRange,
  buildMentionCandidates,
  readRecent,
  writeRecent,
  defaultConfig,
  configToRuntime,
  parseFrontmatter,
  mergeToolsByCallId,
} from "dsh-tui";
import type { FoldedView, VimState, HudState, LiveState } from "dsh-tui";
// 子路径导出（对齐 exports 具名路径）也应被类型校验。
import { countProjectDocs as cd, projectDocsLabel as pd } from "dsh-tui/docs";
import { resolveVersion as rv } from "dsh-tui/version";
import { detectIntent as di, parseLineRange as plr, buildMentionCandidates as bmc } from "dsh-tui/mention";

// ---- DshClient：验证 request/respond（而非不存在的 call）----
async function clientUse(client: DshClient) {
  const v: unknown = await client.request("session.list", {});
  const r: { accepted: boolean } = await client.respond("rpc-1", { ok: true, value: {} });
  return { v, r, base: client.baseUrl };
}

// ---- fold / view ----
function foldUse(entries: Array<object>) {
  const view: FoldedView = foldEvents(entries);
  const last = lastAssistantText(view);
  return { turn: view.turn, lastTurnStart: view.turnStartTime, last };
}

// ---- Session ----
async function sessionUse(client: DshClient, id: string) {
  const s = await Session.open(client, id);
  const hist = await s.history({ beforeSeq: 5, maxMessages: 100 });
  const reply = await s.converse("hi", { timeoutMs: 1000 });
  return { id: s.sessionId, n: hist.events.length, reply };
}

// ---- Live ----
function liveUse(conv: LiveConversation) {
  const st: LiveState = conv.snapshot();
  const n = conv.permissionMode;
  conv.setPermissionMode(parseMode("manual"));
  conv.answerQuestion({ rpcId: "x" }, [{ id: "q1", selected: ["a"] }]);
  return { running: st.running, n };
}

// ---- vim / bridge ----
function vimUse() {
  let v: VimState = createVim();
  v = { ...v, mode: "insert" };
  v = processInput(v, "a", { return: false }).state;
  const out = vimKey(v, "enter").action;
  const text = submitText(v);
  return { out, text };
}

// ---- hud ----
function hudUse(view: FoldedView) {
  const h: HudState = hudState({ view, session: { agentPreset: "code", cwd: "/" }, now: Date.now() });
  return { label: h.modelLabel, cost: h.costUsd, tok: formatTokens(h.usage.input) };
}

// ---- slash / commands ----
function slashUse() {
  const panel = buildSlashPanel("/re", allCommands(), { active: 0 });
  const p = parseSlash("/resume x");
  const routed = routeSlash("/git status");
  return { panel, name: p?.name, routed: routed?.local };
}

// ---- mention / docs / version ----
function smallUse() {
  const cands = buildMentionCandidates("main", ["src/main.ts"], 8);
  const ranged = parseLineRange("a.ts#10-20");
  const intent = detectIntent("!ls");
  const docs = countProjectDocs(["CLAUDE.md"]);
  const label = projectDocsLabel(["CLAUDE.md"]);
  const ver = resolveVersion({ version: "1.2.3" }, "0.0.0");
  return { cands: cands[0]?.file, rangedFile: ranged?.file, kind: intent.kind, docs, label, ver };
}

// ---- registry / config ----
function cfgUse() {
  const recent = readRecent();
  writeRecent("session-x", { agentPreset: "code" });
  const cfg = configToRuntime(defaultConfig());
  const fm = parseFrontmatter("---\ndescription: hi\n---\nbody");
  const nextModeVal = nextMode(parseMode("manual"));
  const badge = modeBadge(parseMode("acceptEdits"));
  return { recentId: recent?.sessionId, cfg: cfg.approvalMode, fm: fm.description, nextModeVal, badge };
}

// 汇总，确保每个函数都被真实调用（避免未使用告警 + 让签名被校验）
export const _ = {
  clientUse, foldUse, sessionUse, liveUse, vimUse, hudUse, slashUse, smallUse, cfgUse,
  _mux: MuxStream, _init: initialState, cd, pd, rv, di, plr, bmc,
  mtools: mergeToolsByCallId([{ seq: 1, callId: "c", name: "x", args: "", status: "running" }], [{ seq: 2, callId: "c", status: "done" }]),
};
