/** 解析包版本：优先取 pkgJson.version，缺省回退 fallback。CLI --version 的正确来源。 */
export function resolveVersion(pkgJson: object | null, fallback?: string): string;
