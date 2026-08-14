# Security Policy

- 禁止提交 API Key、Cookie、Authorization header、浏览器会话、真实提示词和未脱敏日志。
- `.env`、私钥、生产数据库和 credential dump 不得进入 Git。
- 发现泄漏时立即停止推送并通知用户；先轮换 secret，再由用户决定历史清理。
- Issue、fixture、截图和交接记录均需脱敏。
