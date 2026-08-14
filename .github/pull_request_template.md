---
name: Pull Request
about: 提交代码改动
title: ""
labels: []
assignees: []
---

## 动机

（为什么改？修复了什么问题 / 实现了什么需求 / 或是对标的哪类产品能力）

## 改动内容

- （做了什么，逐条）

## 验证

- [ ] 已关联 `.collab/workstreams/<id>.md`，且未越过写入范围
- [ ] `npm run check:governance` 通过
- [ ] `npm run check` 通过
- [ ] `npm test` 全绿（当前基线 `116` 单测）
- [ ] 涉及真实 host 链路时 `npm run test:live` 通过
- [ ] 有真实终端/截图验证（如涉及 UI 布局）

## 兼容性

- 是否改动 `core/`（`lib/`）层？如是，是否保持「纯函数 + 零 Node 依赖 + 可单测」？
- 是否破坏现有 CLI / API ？

## 备注

（其它需要 reviewer 注意的）

## 风险、恢复与用户验证

- Recovery point / revert 步骤：
- [ ] 独立 Reviewer 已检查
- [ ] 用户已亲自完成关键终端流程（未勾选时不得合并 main）
