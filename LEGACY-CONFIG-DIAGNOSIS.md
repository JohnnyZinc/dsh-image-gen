# settings.yaml 的 `image-generation` 遗留字段诊断

- **诊断对象**：`~/.dsh/settings.yaml` 的 `image-generation` 节（DSH 用户层配置）
- **对照代码**：本仓库 `src/`（0.7.0），与已装产物 `~/.dsh/profiles/web/node_modules/dsh-image-gen/lib/` 一致
- **诊断日期**：2026-09-08
- **状态**：~~只诊断，未改动任何代码与配置~~（`settings.yaml` 原样保留）
- **更新（2026-09-09）**：已按 §6 **A2 方案**完成 Studio 工作台渠道化改造（详见 §10）。
  本文 §2/§3 中"Studio 仍完全基于老字段工作"的结论**已不成立**；镜像仍在写入（阶段 2 尚未执行）。

---

## 0. TL;DR

1. 那些"看起来没用的字段"不是没人读的死代码，而是插件**主动写入的兼容镜像**（legacy mirror）。
2. 唯一的活读者是 **Studio 工作台**（`src/studio.ts`）——它只认"按 provider 平铺"的老字段，不认新的 `channels`。
3. 因此清理顺序必须是：**先让 Studio 读 channels → 再停止写镜像 → 最后删字段**。顺序颠倒会让工作台静默回落到代码默认端点/模型。
4. 全节里唯一"当前版本没有任何代码写入"的真遗留是 **`provider: gitee`**（但它仍被 `describeStudio` 当默认 provider 读，且与 `defaultChannelId` 指向的 Antigravity 不一致）。
5. 仓库当前**没有任何测试文件**（vitest 已装、0 用例），验收只能靠构建 + 运行时/HTTP 实测。

---

## 1. 现象

`image-generation` 节同时存在两代结构：

```yaml
image-generation:
  provider: gitee                 # ← 0.5.x 之前的"单 provider 单选"
  giteeModel: FLUX.2-dev          # ← 0.5.x–0.6.x 的"按 provider 平铺"
  giteeModels: [...]
  giteeBaseURL: ...
  modelscopeBaseURL/Model/Models: ...
  antigravityBaseURL/Model/Models: ...
  comfyuiBaseURL/Workflows/ActiveWorkflow/WorkflowJson/WorkflowName/TimeoutMs: ...
  channels: [...]                 # ← 0.6.x 之后的"渠道实例"（新存储）
  defaultChannelId: ch-mtqv98kx
  defaultModel: gemini-3.1-flash-image
```

参考：仓库外的 `~/.dsh/settings.yaml.bak-imagegen-050` 保留了 0.5.0 之前的样子
（`provider: openai` + `openaiModel: z-image-turbo` + `openaiBaseURL: https://ai.gitee.com/v1`，即"借 OpenAI 兼容口打 Gitee"的时代）。

---

## 2. 结论：两代并存 + 主动镜像

- 新存储：`channels`（渠道实例）+ `defaultChannelId` + `defaultModel`。
- 老结构：`provider` + 每个 provider 的 `<provider>Model(s)` / `<provider>BaseURL|Endpoint`。
- **写入方**：设置页保存渠道时，除了写 `channels`，还会把每个 provider 的**第一条渠道**镜像回老字段
  （`src/client/settings-card.tsx:618-648`，注释原文 *"Mirror per-provider legacy fields so the Studio workbench stays functional."*）。
- **读取方**：Studio 工作台（`src/studio.ts`）仍完全基于老字段工作；Agent 工具侧则已完全基于 `channels`。
- 换句话说：**老字段是 Studio 的"投影"，不是无人问津的垃圾**。

> 重要推论：今天 Studio 之所以能用上你渠道里自定义的端点，正是因为镜像把 `baseURL` 复制成了 `<provider>BaseURL`。
> 一旦"停写镜像"而 Studio 还没改造，Studio 就会回落到代码默认端点（如 Antigravity 从 `gemini-3.1-flash-image` 掉到 `gemini-3-pro-image`）。

---

## 3. 证据链（文件:行）

### 3.1 写入方

| 位置 | 作用 |
|---|---|
| `src/client/settings-card.tsx:618-648` | `persistChannels`：写 `channels`（626）后镜像 `endpointKey/modelKey/modelsKey`（643-646） |
| `src/client/settings-card.tsx:712-726` | `saveComfy`：写 `comfyuiWorkflowJson` / `comfyuiWorkflowName`（724-725）——**降级兼容**镜像，与 Studio 无关 |
| `src/client/settings-card.tsx:426-470` | `channelsFromSettings`：`channels` 为空时用老字段**合成**渠道卡片（老配置升级路径） |

### 3.2 读取方（老字段）

| 位置 | 读取内容 |
|---|---|
| `src/studio.ts:63-75` | `describeStudio`：`config.provider` 决定工作台默认 provider（70） |
| `src/studio.ts:257-281` | `studioProfile` → `resolveProvider(withProviderModel(config, provider))`（258） |
| `src/config.ts:192-221` | `resolveProvider`：读 `<provider>Model` / `<provider>BaseURL` / `<provider>Endpoint` |
| `src/studio.ts:41-49` | `CREDENTIALS[provider]`：**只认 provider 级凭据**，忽略渠道的 `apiKeyEnv` 覆盖 |
| `src/config.ts:320-341` | `agentChannels` 的老回退分支：**仅当 `channels` 为空**时按老字段构造渠道 |
| `src/config.ts:293-317` | `modelOptionsFor` / `channelExplicitlyConfigured`：只服务上面的老回退 |
| `src/shared.ts:160-170` | `resolveComfyUIWorkflows`：`comfyuiWorkflows` 为空时回退到 `comfyuiWorkflowJson/Name` |

### 3.3 反向验证（Agent 侧已不读老字段）

- 工具入口只走新路径：`src/index.ts:143`、`src/index.ts:231` → `resolveAgentSelection` → `channelProfile`。
- `channelProfile`（`src/config.ts:451-466`）在**内存里**合成一个"老形状"的配置喂给 `resolveProvider`，**不落盘**。
  所以即便将来删掉 schema 里的老键，这套内部合成仍然可用（只需给内部函数一个独立类型）。
- 渠道级凭据覆盖在 Agent 侧是生效的：`src/index.ts:162`（`channel.apiKeyEnv || active.apiKeyEnv`）；**Studio 侧没有等价逻辑**，属于改造时要一并修掉的 bug。

---

## 4. 逐字段清单（对应当前 `~/.dsh/settings.yaml:79-129`）

| settings.yaml 行 | 字段 | 谁写 | 谁读 | 状态 / 处置 |
|---|---|---|---|---|
| 80 | `provider: gitee` | **当前版本无写入方** | `studio.ts:70` | 真遗留；与 `defaultChannelId` 不一致；可改/可删 |
| 81 | `giteeModel` | `persistChannels` | Studio + 老回退 | 镜像；Studio 改造后可删 |
| 82-86 | `giteeModels` | `persistChannels` | 仅老回退 | 镜像；可删 |
| 87 | `saveToWorkspace` | 工作区卡片 | 落盘逻辑 | **生效，保留** |
| 88 | `workspaceFolder` | 工作区卡片 | 落盘逻辑 | **生效，保留** |
| 89-111 | `channels` | `persistChannels` | Agent + 设置页 | **新存储，保留** |
| 112 | `giteeBaseURL` | `persistChannels` | Studio + 老回退 | 镜像；可删 |
| 113 | `comfyuiBaseURL` | ComfyUI 卡片 | ComfyUI 适配器 | **生效，保留** |
| 114 | `comfyuiWorkflows: []` | ComfyUI 卡片 | 工作流解析 | **生效，保留** |
| 115 | `comfyuiActiveWorkflow: ""` | ComfyUI 卡片 | 工作流选择 | **生效，保留** |
| 116 | `comfyuiWorkflowJson: ""` | `saveComfy` | 降级回退 | 降级镜像；可删（需同步删回退） |
| 117 | `comfyuiWorkflowName: ""` | `saveComfy` | 降级回退 | 同上 |
| 118 | `comfyuiTimeoutMs: 300000` | ComfyUI 卡片 | 适配器 | **生效，保留** |
| 119 | `modelscopeBaseURL` | `persistChannels` | Studio + 老回退 | 镜像；可删 |
| 120 | `modelscopeModel` | `persistChannels` | Studio + 老回退 | 镜像；可删 |
| 121-123 | `modelscopeModels` | `persistChannels` | 仅老回退 | 镜像；可删 |
| 124 | `defaultChannelId: ch-mtqv98kx` | 默认模型单选 | Agent 选择 | **生效，保留** |
| 125 | `defaultModel: gemini-3.1-flash-image` | 默认模型单选 | Agent 选择 | **生效，保留** |
| 126 | `antigravityBaseURL` | `persistChannels` | Studio + 老回退 | 镜像；可删 |
| 127 | `antigravityModel` | `persistChannels` | Studio + 老回退 | 镜像；可删 |
| 128-129 | `antigravityModels` | `persistChannels` | 仅老回退 | 镜像；可删 |

> 镜像值当前与 `channels` **完全同步**（`giteeModel` = gitee 渠道首个模型；`modelscope*`/`antigravity*` 同理），
> 说明最近一次保存渠道时镜像块确实跑过。

### 为什么会落盘"空值"键

`comfyuiWorkflows: []`、渠道里的 `apiKeyEnv: ""`、`comfyuiTimeoutMs: 300000` 这类键，是因为保存处理器**无条件写全部键**
（`settings-card.tsx:643-646`、`721-726`），并非 DSH 在 dump schema 默认值——同文件其它节（如 `ui-onboarding`）只有一个键，可作反证。

---

## 5. 唯一的真遗留：`provider`

- 全仓检索：**没有任何 `scope.set('provider')`**（只有读）。
- 它是 0.6.x 之前"单 provider 单选"时代的产物，但 `describeStudio`（`studio.ts:70`）仍把它当工作台默认 provider。
- 现状不一致：`defaultChannelId: ch-mtqv98kx` → Antigravity；`provider: gitee` → 工作台默认停在 Gitee AI。
- 处置选项：改成 `antigravity` 对齐，或随改造一起删掉（改为由 `defaultChannelId` 推导）。

---

## 6. 改造方案对比

| | **A1 最小渠道化（推荐）** | **A2 工作台真正渠道化** |
|---|---|---|
| 思路 | `describeStudio` 用 `agentChannels(config)` 生成 profile（同一 provider 多渠取默认/首个），`generateFromStudio` 用 `channelProfile` + 渠道凭据覆盖 | profile 按 `channel.id` 键；wire 契约由 `provider` 改为 `channelId` |
| 改动面 | `src/studio.ts` 单文件（可能需导出 `defaultModelOn` 之类的小工具） | `shared.ts` 类型 + `studio.ts` + `studio-route.ts` + `client/studio-view.tsx` + `client/multi-model-compare.ts` + `client/conversation-regenerate.ts`（约 6 个文件） |
| 额外阻碍 | 无 | 生成记录只存 `provider`+`model`（`src/index.ts` 的 `saveGenerated` 调用处），**没存 channelId**；重生成/对比需按 (provider, model) 反查渠道 |
| 收益 | 老字段彻底无人读 → 可安全删除；顺带修好"Studio 忽略渠道 `apiKeyEnv` / 自定义端点" | 工作台支持多渠道实例、多模型下拉、自定义端点可见 |
| 风险 | 低（客户端零改动；工作台下拉项会从固定 7 个变成"仅已声明渠道"） | 中（跨文件 + 历史图片元数据兼容） |
| 已知限制 | 同一 provider 的第二条渠道在工作台不可见 | 无 |

---

## 7. 分阶段执行计划

### 阶段 1｜Studio 渠道化（A1）

- `src/studio.ts`
  - profile 来源改为 `agentChannels(config)`（过滤掉 `comfyui`）；
  - 每个 profile 的模型取该渠道的默认模型（复用 `defaultModelOn` 语义）；
  - `configured` 按 `channel.apiKeyEnv || 默认凭据` 探测；
  - `generateFromStudio` 用 `channelProfile(config, channel, model)` 解析 provider 档案，凭据解析与 `src/index.ts:162` 同规则；
  - `activeProvider` 由 `defaultChannelId` 推导（回退：首个已配置渠道 → 首个渠道）。
- 验证：`pnpm typecheck` → `pnpm build` → 打包 → 安装 → 重启 DSH →
  `curl -s http://127.0.0.1:3080/plugins/dsh-image-gen/studio` 检查 `providers` 来自 3 条渠道、`activeProvider` 正确 →
  浏览器打开工作台截图确认下拉项与模型。
- 回滚：`git revert` / 重装上一版 tgz。

### 阶段 2｜停止写镜像

- 删 `settings-card.tsx:627-647` 的镜像块（保留 626 的 `scope.set('channels', ...)`）。
- 删 `settings-card.tsx:724-725`（`comfyuiWorkflowJson/Name` 两行）——可选，视是否保留降级兼容。
- **酸测试**：在设置里改一次渠道 → 检查 `~/.dsh/settings.yaml` **不再**出现/重写 `giteeModel` 等键。

### 阶段 3｜删除 settings.yaml 老键

- 改前备份（仓库已有 `.bak-imagegen-050` 的先例）。
- 删除：`provider`、`giteeModel/giteeModels/giteeBaseURL`、`modelscope*`、`antigravity*`、`comfyuiWorkflowJson/comfyuiWorkflowName`。
- 保留：`channels`、`defaultChannelId`、`defaultModel`、`comfyuiBaseURL/comfyuiWorkflows/comfyuiActiveWorkflow/comfyuiTimeoutMs`、`saveToWorkspace`、`workspaceFolder`。
- 验证：设置页 3 条渠道仍在、默认模型不变、插件正常注册（DSH 对 settings 文件有监听与热重载）。

### 阶段 4｜（可选，独立提交）清代码里的 legacy

- 删 schema 键（`src/config.ts:149-189`）与 `Config` 接口老字段（`83-121`）；
- 给 `withProviderModel` / `channelProfile` 的内部合成一个独立类型；
- 删 `agentChannels` 老回退（`320-341`）、`modelOptionsFor`（`293-303`）、`channelExplicitlyConfigured`（`306-317`）；
- 删 `channelsFromSettings` 的老合成（`settings-card.tsx:426-470`）；
- 删 `resolveComfyUIWorkflows` 的老回退（`shared.ts:160-170`）；
- 同步改 `cordis.patch.yml:1-5` 的 `config: provider: google`（base 层）。
- 代价：放弃 ≤0.6.x 配置的自动升级路径。

### 构建 / 安装 / 校验速查

```powershell
# 仓库根目录
pnpm typecheck
pnpm build                 # tsc && tsdown → lib/
pnpm pack                  # 产出 dsh-image-gen-<version>.tgz（建议 bump 版本号）
pnpm dsh plugin --profile web add file:<abs path>\dsh-image-gen-<version>.tgz
# 然后重启 DSH Web（127.0.0.1:3080）

# 产物校验（历史上出现过"装了旧副本"）
# 对比 ~/.dsh/profiles/web/node_modules/dsh-image-gen/lib/index.js 与 src/ 的改动是否一致

# 运行时校验
curl -s http://127.0.0.1:3080/plugins/dsh-image-gen/studio
```

---

## 8. 完成定义（DoD）

1. `pnpm typecheck` 通过；构建产物确实包含新逻辑。
2. DSH 重启后插件正常注册，无 schema 相关报错。
3. `GET /plugins/dsh-image-gen/studio` 的 `providers` 来自 `channels`（3 条），`activeProvider` 与 `defaultChannelId` 一致。
4. 工作台截图：provider 下拉项、模型 = 渠道默认模型。
5. 酸测试：保存渠道后 `settings.yaml` 不再出现镜像键。
6. 真实出图一次成功（验证端点与凭据链路）。

---

## 9. 待决策

| # | 决策点 | 建议 |
|---|---|---|
| 1 | A1 还是 A2 | A1（先摘掉老字段依赖；A2 作为独立特性另做） |
| 2 | 是否保留 ≤0.6.x 读取侧回退（阶段 4） | 保留（零成本安全网，只在 `channels` 为空时生效） |
| 3 | `comfyuiWorkflowJson/Name` 降级镜像去留 | 若不在意降级到 ≤0.6.x，可一并删 |
| 4 | 是否 bump 版本号并同步上游 README 的"多渠道"章节 | 建议 bump（如 0.7.1），便于回滚 |

---

## 附录 A：清理顺序没有加载风险（schemastery 行为）

`schemastery` 的 `object` 对**未知键是保留而非拒绝**：

```ts
// node_modules/@deepseek-ai/schemastery/src/index.ts:752-763
Schema.extend('object', (data, { dict }, options, strict) => {
  ...
  if (!strict) merge(result, data)   // 未知键被并入结果
  return [result]
})
```

`@deepseek-ai/dsh-settings` 只在"存储的 section 被 schema **拒绝**"时才让注册失败（README: "A stored section the schema rejects fails the registration itself"）。
因此"先删 yaml 还是先删 schema"都不会导致插件加载失败；真正会失败的是类型/约束不匹配。

另外：DSH 的写入只落**用户层**（`update` 深合并、`replace` 整体替换、`mutate` 支持 `{op:'unset', path}` 单键删除），
所以删掉的键不会被 schema 默认值重新写回——**只有插件的 `scope.set` 会重新写入**（这正是阶段 2 要处理的对象）。

## 附录 B：本仓库当前没有测试

`vitest` 已在 devDependencies，`pnpm test` 存在，但 `src/` 下**没有任何 `*.test.ts`**（全仓匹配结果均落在 `node_modules`）。
因此上述改造的验收必须依赖：typecheck + 构建 + 安装后运行时实测 + 截图 + 酸测试；建议在阶段 1 顺手补上 `src/config.ts` / `src/studio.ts` 的单测。

## 附录 C：当前配置速查（诊断时的实际值）

| 渠道 id | provider | baseURL | models |
|---|---|---|---|
| `gitee` | gitee | `https://ai.gitee.com/v1` | FLUX.2-dev, FLUX.2-klein-9B, GLM-Image, z-image-turbo |
| `ch-mtqa4yl4` | modelscope | `https://api-inference.modelscope.cn/v1` | Tongyi-MAI/Z-Image-Turbo, krea/Krea-2-Turbo |
| `ch-mtqv98kx` | antigravity | `http://127.0.0.1:8045/v1` | gemini-3.1-flash-image |

- 默认渠道 / 默认模型：`ch-mtqv98kx` / `gemini-3.1-flash-image`
- 老字段 `provider`：`gitee`（与默认渠道不一致）
- ComfyUI：未导入工作流（`comfyuiWorkflows: []`）

---

## 10. 更新记录：A2「工作台真正渠道化」已完成（2026-09-09）

按 §6 的 A2 方案落地，工作台（Studio）已与 Agent 侧一致、完全基于 `channels`：

- **Wire 契约**（`src/shared.ts`）：`StudioProviderProfile` 增加 `channelId` / `models`（多模型下拉数据源）；`StudioGenerateRequest.provider` → `channelId`；`StudioGenerateResponse` 携带 `channelId`；`StudioConfigResponse.activeProvider` → `activeChannelId`。
- **服务端**（`src/studio-profile.ts` 新建纯模块 + `src/studio.ts` + `src/studio-route.ts`）：
  - profile 按渠道生成（`studioChannels` 过滤 comfyui；label 对同 provider 多渠自动消歧）；
  - 每渠道模型列表 = `channel.models`，默认模型 = 渠道默认（`defaultModelOn` 语义）；
  - `configured` 按 `channel.apiKeyEnv || 默认 env` 探测（修掉"Studio 忽略渠道凭据"的 bug）；
  - `activeChannelId` 由 `defaultChannelId` 推导（回退：首个已配置渠道 → 首个渠道），不再读遗留 `provider`；
  - `generateFromStudio` 按 `channelId` 解析 → `channelProfile` + 渠道凭据覆盖（与 `src/index.ts` Agent 侧同规则），校验 `model ∈ channel.models`；
  - 路由校验 `channelId`（非空字符串），删除 `provider ∈ cloud` 校验。
- **客户端**：`studio-view.tsx`（渠道下拉 + 每渠道多模型下拉 + 对比按渠道 + 画廊记录带 `channelId`）、`multi-model-compare.ts`（按 channelId）、`conversation-regenerate.ts`（记录 channelId 优先，否则按 (provider, model) 反查兼容历史记录）、`gallery-store.ts`（`GalleryItem.channelId` 可选）、`gallery-view.tsx`（缓存渠道列表供反查）、`index.tsx`/`image-result-node.ts`（Agent 工具 meta 附加 channelId 溯源）。
- **兼容性**：`agentChannels` 的 legacy 回退保留（无 `channels` 的 ≤0.6.x 配置仍可用，此时 `channelId` = provider 名）；本轮**未**动设置页镜像（阶段 2）与 schema 老键（阶段 4）。
- **验证**：`pnpm typecheck` ✓、`pnpm build` ✓（产物含新逻辑）、`pnpm test` ✓（24 文件 / 274 用例，含新增 4 个渠道化 spec：`studio-profile` / `studio-route` / `conversation-regenerate` / `multi-model-compare`，并适配了既有 `studio.spec.ts`）。
- **未完成（按原计划后续阶段）**：阶段 2 停写镜像（`settings-card.tsx:627-647`）；阶段 3 清理 `settings.yaml` 遗留键；阶段 4 清代码 legacy（schema 老键、`agentChannels` 老回退、`channelsFromSettings` 老合成、`resolveComfyUIWorkflows` 老回退、`cordis.patch.yml` 的 `config: provider`）。
