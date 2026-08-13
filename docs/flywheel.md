# 测试飞轮（PTC 模式）

dsh-tui 的迭代节奏：**改核心 → 测试立刻验证 → 继续改**。核心功能
（会话 / 收发消息 / 事件折叠）必须随时能跑，飞轮就是让它「转起来」的工具。

## 两层飞轮

| 飞轮 | 命令 | 内容 | 速度 |
| --- | --- | --- | --- |
| 单元飞轮 | `npm run flywheel` | `test/`：fold 纯函数 + Session 模型（FakeHost 替身，不碰网络） | 毫秒级，`--watch` 改文件即重跑 |
| live 飞轮 | `npm run flywheel:live` | `test-live/`：真实 host + PTC 模式（code preset）全链路，会调一次真实模型 | 秒级（取决于模型） |

单跑版本：`npm test`（单元）、`npm run test:live`（live 一次）。

live 测试默认跳过（需要 `DSH_TEST_LIVE=1`），由脚本自动注入；也可以直接
`DSH_TEST_LIVE=1 node --test test-live/`。host 地址用 `DSH_URL` 覆盖，默认
`http://127.0.0.1:3080`。

## PTC 模式是什么

PTC 模式 = DSH 的 `code` agent preset：具备标准模式全部能力，并通过
**Code Mode SDK** 呈现工具 —— 模型写一个 TypeScript 程序由 `run_code` 执行，
原来需要多次往返的多步操作变成一次。TUI 新建会话默认用它（`PTC_PRESET`），
live 飞轮测的就是这条真实链路：

```
envelope → host → PTC agent（Code Mode SDK）→ 模型 → 历史 → 折叠视图
```

## 被测核心（milestone 2 事件接缝）

- `lib/client.js` — `DshClient`：四象限信封 unary RPC。
- `lib/session.js` — `Session`：create / open / prompt / history / **converse**。
  `converse` 是最小闭环：发消息 → 以 prompt 前 lastSeq 为基线轮询 history →
  等本轮 `turn/end` → 折叠视图。
- `lib/fold.js` — `foldEvents`：纯函数，任何事件源（history 页 / 流帧）喂进去
  得到同一份对话视图（messages / tools / turn / lastTurnEnd / lastSeq）。

## 新增一个测试的规矩

1. 纯逻辑 → `test/`，用 FakeHost 替身，不碰网络。
2. 真实 host 链路 → `test-live/`，开头加 `skip: !process.env.DSH_TEST_LIVE && "..."`，
   保持默认 `npm test` 快且无副作用。
