/** 项目内置文档计数（Claude Code "1 CLAUDE.md" / Codex AGENTS.md 约定）。 */
export const DOC_NAMES: Array<string>;
/** 从文件名列表统计内置项目文档数量。 */
export function countProjectDocs(filenames?: Array<string>): number;
/** 汇总一条 HUD 用的文档显示（"2 docs" / ""）。 */
export function projectDocsLabel(filenames?: Array<string>): string;
