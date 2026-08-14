/**
 * dsh-tui 核心库入口（core 层，不依赖任何 UI、零构建、纯 Node ESM）。
 *
 * 这是开放核心：Ink UI、CLI、VSCode 集成都可以直接 import 这些 API。
 * 每个模块职责：
 * - client：DshClient（四象限信封 unary RPC）+ respond（应答 server-request）
 * - fold：事件折叠（history 页 / 流帧 → 对话视图）
 * - session：会话模型 + PTC 模式 + 恢复
 * - stream：mux SSE 传输（读事件流，yield 带 rpcId 的信封）
 * - live：LiveConversation（基线 + 增量 + 流式草稿 + 应答 + 切换）
 * - vim：Vim 模态输入状态机
 * - bridge：Ink useInput 事件 → vim 按键
 * - hud：HUD 状态派生（model/PTC/成本/token）
 * - slash：slash 命令过滤 / 面板派生
 * - commands：本地 vs host 命令路由
 * - policy：question/approval 自动应答策略
 * - registry：客户端会话记忆（最近会话持久化）
 */
export { DshClient, mintRpcId } from "./client.js";
export { foldEvents, lastAssistantText } from "./fold.js";
export { Session, PTC_PRESET } from "./session.js";
export { MuxStream, respond, extractSseData, parseServerRequest } from "./stream.js";
export {
	LiveConversation,
	initialState,
	mergeToolsByCallId
} from "./live.js";
export { createVim, vimKey, submitText, MODES } from "./vim.js";
export { keyToVimKey, inputToKeys, processInput } from "./bridge.js";
export { hudState, sumUsage, priceFor, costUsd, formatCost, formatDuration, formatTokens, turnElapsedLabel, contextWindowLabel, toolDurationLabel, DEFAULT_PRICES } from "./hud.js";
export { filterCommands, commandGroup, buildSlashPanel, BUILTIN_COMMANDS } from "./slash.js";
export {
	parseSlash,
	routeSlash,
	isLocalCommand,
	allCommands,
	LOCAL_COMMANDS
} from "./commands.js";
export { answerQuestions, answerApproval, hasPlanReview, declinePlan } from "./policy.js";
export { readRecent, writeRecent, clearRecent } from "./registry.js";
export {
	PERMISSION_MODES,
	parseMode,
	nextMode,
	allowToolsForMode,
	shouldDeclinePlanReview,
	modeBadge,
	modeColor
} from "./permission.js";
export { parseFrontmatter, loadCustomCommands, listCommandsFromDir } from "./command-loader.js";
export { defaultConfig, parseConfig, loadConfig, configToRuntime } from "./config.js";
export { createHistory, pushHistory, navigateHistory } from "./history.js";
export { diffLinesFrom, classifyDiffLines, diffStats, diffSummary, guardDiff } from "./diff.js";
export { UI_MODES, deriveMode, modeLabel } from "./ui-mode.js";
export { resolveVersion } from "./version.js";
export { countProjectDocs, projectDocsLabel, DOC_NAMES } from "./docs.js";
export { detectIntent, parseLineRange, buildMentionCandidates, mentionDisplay, parseMentionQuery, mentionRef } from "./mention.js";
export { sanitizeControlChars, hasControlChars, safeSingleLine } from "./safety.js";
export { createTimingAccumulator, advanceTiming, formatDurationMs, timingSummary } from "./timing.js";
export { scanWorkspace, mentionScanEntries } from "./scan.js";
export { dedupeUsage, hasAnyUsage, usageZero } from "./usage.js";
export { toolSummary } from "./tool-summary.js";
export { parseMarkdown, inlineFragments, cachedParseMarkdown, clearMarkdownCache, markdownCacheSize } from "./markdown.js";
export { displayWidth, wrapLines, estimateMessageRows, tailWithinBudget, messageBudget } from "./viewport.js";
