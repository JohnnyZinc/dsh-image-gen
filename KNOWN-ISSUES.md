# Known Issues / 已知问题

本文件记录已确认但**暂未修复**的问题。每条包含：现象、复现步骤、状态、排查方向。
修复后请把对应条目移出并标注修复版本。

---

## 1. 画廊「重新生成」点击后无反应（gallery regenerate no-op）

- **状态**：已知未修复（记录于 2026-09-09，v0.7.1 渠道化改造后）
- **现象**：在图库中点击一张已生成的图片，图片下方出现一排操作按钮；点击「重新生成」会弹出模态框（正确展示所用**渠道 / 模型 / 尺寸**，并带一个可编辑的提示词文本框，文本提示可在此修改提示词），底部有「开始生成」按钮。点击「开始生成」后**没有任何反应**——不出现新图片，也没有可见的错误提示。
- **复现步骤**
  1. 图库（画廊）中点开任意一张图片；
  2. 点击「重新生成」；
  3. 在模态框中确认渠道/模型/尺寸与提示词；
  4. 点击「开始生成」→ 无反应。
- **影响范围**：画廊重生成链路；对话卡片内的图片重生成（`src/client/index.tsx` 的 `ImageResultCard`）是否同样受影响待确认。
- **排查方向（未验证）**
  - 重生成请求构建在 `src/client/conversation-regenerate.ts`（`conversationRegenerateRequest`）：旧记录没有 `channelId`，依赖按 `(provider, model)` 反查渠道（`resolveChannelId`）。若渠道快照未加载（如 `src/client/gallery-view.tsx` 的 `serverProfiles` 为空），会抛出「当前图片使用的渠道已不存在…」，错误只以短暂 toast 提示，容易被忽略——需先确认点击后是否有瞬时 toast / console 报错。
  - 请求 POST 到 `STUDIO_ROUTE`（`/plugins/dsh-image-gen/studio`），需确认请求是否发出、服务端返回什么（可用 DevTools Network 面板或服务端日志）。
  - 观察点：模态框是否关闭、`isRegenerating` 是否卡住、`showToast` 是否触发。
- **相关代码**：`src/client/gallery-view.tsx`（`handleConfirmRegenerate`）、`src/client/index.tsx`（`regenerate`）、`src/client/conversation-regenerate.ts`（`resolveChannelId`）、`src/studio-route.ts`（请求校验）、`src/studio.ts`（`generateFromStudio`）。
