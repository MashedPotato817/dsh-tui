/**
 * dsh-tui 核心库入口（core 层，不依赖任何 UI）：
 * - DshClient：四象限信封载体（unary RPC over HTTP）。
 * - foldEvents：事件折叠（history 页 / 流帧 → 对话视图）。
 * - Session / PTC_PRESET：会话模型 + PTC 模式（code agent preset）。
 *
 * 这一层保持零依赖、纯 Node —— Ink UI、CLI、VSCode 集成都可以直接 import。
 */
export { DshClient, mintRpcId } from "./client.js";
export { foldEvents, lastAssistantText } from "./fold.js";
export { Session, PTC_PRESET } from "./session.js";
