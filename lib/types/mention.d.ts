/** 输入补全意图识别（OpenCode `@`/`#`/`!` 心智）。 */
export type IntentKind = "shell" | "mention" | "slash" | "text";
export interface Intent {
  kind: IntentKind;
  rest: string;
}
/** 识别输入意图。 */
export function detectIntent(text: string): Intent;
/** 解析 `@file#start-end` 行范围引用。 */
export function parseLineRange(mention: string): { file: string | null; start: number | null; end: number | null } | null;
/** 为 `@` 文件引用生成本地文件候选（前缀/基名/包含排序）。 */
export function buildMentionCandidates(mentionSoFar: string, files?: Array<string>, limit?: number): Array<{ file: string; score: number }>;
/** 把候选渲染成一行（OpenCode 风格）。 */
export function mentionDisplay(c: { file: string }): string;
