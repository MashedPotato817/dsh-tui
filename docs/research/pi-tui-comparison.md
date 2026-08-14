# pi-tui（@openguardrails/dsh-tui）源码精读 —— 与 dsh-tui 对比 + 可借鉴点

> 调研对象：本机 `~/.dsh/profiles/tui/node_modules/@openguardrails/dsh-tui@0.1.2`（基于 `@earendil-works/pi-tui`，从 DSH 官方历史 recover 的 TUI，`.ts` 源码在 `src/`）。
> 结论先行：**它在「滚动/follow-tail」上不如我们 dsh-tui 0.2.19**（它没有应用级滚动，用户靠原生 scrollback 回看，输入框"固定"只是布局结果，任何组件高度变化会整屏重排——正是我们修掉的原 viewport 跳动）。但它有几个**工程点确实值得抄**，且能落在我们的 Ink + lib/ 纯函数架构里。

## 一、pi-tui 最大架构事实
- Markdown 用 `marked 18.0.5` + `diff` 库；`pi-tui` 只作 devDependency。
- 聊天流是**单个不断增长的 Container**（`src/index.ts`），全程渲染成全高度，无虚拟化。
- **全文没有 followTail / scrollOffset / setScroll**；PageUp/PageDown 只在对话框/候选列表，不在主体聊天上。

## 二、滚动/跟随（我们更优）
- **它完全不自己管滚动**。长会话靠终端 scrollback 回看；无"回到底部"提示、无上翻锚点保持。
- 输入框"固定" = 布局末位 + 每帧全量重排，任何卡片展开/todo 增减会整屏重排。
- → **我们的 dsh-tui 0.2.19 的 app-level follow-tail（PageUp/PageDown/End + 回到底部提示 + 上翻不改锚点 + 输入区固定）明显更优，应当保留，不能退回 scrollback 模型。**

## 三、值得抄的工程点（已在源码核实，可落在我们 Ink 架构）

### 1. 定稿内容按 width 行缓存，状态变更才失效（transcript.ts CachedCardComponent）
按宽度缓存 `render()` 产物、`dropLines`/`invalidate` 失效，避免每帧重排长文本。
→ 我们可加：单条落定消息的 Markdown 渲染结果按 `{textHash, columns}` 缓存，streaming 变化不重排已落定消息。

### 2. 计时用「共享游标的一次前向扫描」，防逐 step 回放二次方退化（timing.ts）
`StepTimingTracker` 对整个事件流一次扫描累加 `ttft/thinking/responding/tools` 桶，全脚本共享游标，**整个会话计时 O(events) 而非 O(step×events)**。
→ 我们可加：turn 计时不要每步从事件重扫，维护增量累加。

### 3. token 按 turn:step 键控去重 + 放「输入区前的 prompt 装饰片段」而非独立状态栏（tokens.ts）
`↑in ↓out cache n%` + `n% context` 展示在输入框前（不是底部独立状态栏）。
→ 我们可考虑：把 HUD 的 token/context 改放输入框装饰位，或保持现状但借鉴 `turn:step` 去重累加避免重复计。

### 4. 长工具输出「折叠」而非裁剪（transcript.ts preview）
工具输出超长时折叠成头尾中间省略，不丢内容。
→ 我们工具卡目前是单行摘要；可加 Ctrl+O 三态（collapsed/expanded/hidden）循环 + 统一折叠规则。

### 5. 流式期 vs settle 期渲染路径分离（他们没做分级，我们可以做到）
settledContent 与 blocks 分离，但两者同走完整 Markdown。**我们可升级为：流式期轻渲染（纯文本/轻行）、settle 期才做完整 Markdown**。

### 6. diff 编辑距离预算 maxEditLength=1000，超预算回退整边渲染并标 approximate（transcript.ts/config.ts）
防御模型写的坏 diff 卡死界面。
→ 我们 `lib/diff.js` 可加预算守卫。

## 四、交互细节（theme/autocomplete/dialogs 子代理补充）

### 主题（theme.ts）
- 语义 token 化（accent/text/dim/success/warning/error/code + 属性角色），几乎无硬编码。
- `dim` 用 **SGR 2**（非亮黑 90，浅色下更稳）；`selected` 用反色而非固定色相。
- `scheme: dark|light` 只影响 `code` 一个角色，无整主题切换。

### 文件补全（file-autocomplete.ts）—— 比我们更完整
- 两级策略：含 `/` 的查询时实时 `readdir` 该目录；裸名查询走**共享有界 BFS 目录索引**（限 10000 项，排除 `.git`/`node_modules`）。
- **分级打分**：完整名 > 前缀 > 包含 > 路径包含 > **子序列匹配**；目录 bonus；按分数/目录/路径长度/字典序排序。
- 插入整 token 替换为 `@path` 或 `@"path with spaces"`；目录尾带 `/` 下钻。

### 审批/问题弹窗（dialogs.ts + questions.ts + overlay-manager.ts）
- 不是阻塞主循环，而是**异步 FIFO 模态队列**，单焦点、AbortSignal 贯穿、queueMicrotask 轮转。
- 单选/多选(Space)/自定义(Tab) 三种模式；Esc/Ctrl+C 取消即拒绝 plan；Tab 循环即时预览。

### 工具卡片（xml-tool-output.ts）
- 三态 hidden/collapsed/expanded，Ctrl+O 循环；状态 `○/●` + 头部颜色（warning→success→error）；统一折叠规则。

### 通用
- `displayText()` 控制字符转义（防御模型输出裸 ESC/控制字符破坏布局）。

## 五、诚实局限（pi-tui 也踩的坑）
1. 无应用级 follow-tail → 无法满足「PgUp/PgDn 锚点 + End 回底 + 输入框绝对固定」；我们更优。
2. 每 chunk 全量 re-parse marked（`+=` 累加 → rebuild() 全量 Markdown），只是靠 ~50ms 节流压住，超长 code block 期间可能卡。
3. 整 transcript 单 Container 每帧渲染、无虚拟化，超长会话单帧成本线性涨。
4. 输入框"固定"是布局结果，组件高度变化会整屏重排 = 我们要避免的视口跳动。
5. 对话框 `.slice(0, maxHeight)` 硬裁，超高直接截断而非滚页。

## 六、建议采纳优先级（落到 dsh-tui 0.2.19）
- **P0 保留**：我们的 app-level follow-tail（别退回 scrollback 模型）。
- **P1 高价值、低风险**：① `displayText()` 控制字符转义（防布局破坏）；② diff 编辑距离预算守卫（lib/diff.js）；③ 流式轻渲染 vs settle 完整 Markdown 分离（可再加一层）。
- **P1 交互增强**：④ 工具卡 Ctrl+O 三态折叠/展开；⑤ 文件补全升级为「目录索引 + 子序列打分 + 目录下钻」（我们已有 `@` 基础，可加目录扫描/打分）。
- **P2 优化**：⑥ 定稿消息宽度缓存；⑦ turn:step token 去重；⑧ 语义 token 主题(尤其 dim 用 SGR 2)。
