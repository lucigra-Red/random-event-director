# 参考仓库与架构选择

研究日期：2026-10-04。原目录只有角色卡、世界书和图片；未发现 SillyTavern/Luker 项目源码。没有修改既有素材。

## 1. SS-Helper-RollHelper

[仓库](https://github.com/ShionCox/SS-Helper-RollHelper) · 核实文件：`manifest.json`、`README.md`、已构建 `index.js`；Git tree `36a9c8b7617c53f09599bde81352cc7ba05ab285`，manifest 版本 1.2.0。

实际分发形态是有 manifest 和 JS 入口的 Extension，而不是仅凭名称就能认定为酒馆助手脚本。构建包取得 `SillyTavern.getContext()`，监听 prompt-ready、generation-ended、聊天变更以及消息编辑/删除/swipe。存在 STX bus/registry 集成，以及按聊天身份读写技能/状态/pending round 的独立宿主存储层。

值得借鉴：crypto 拒绝采样骰子、稳定的用户回合标识、聊天范围状态、pending 与已结算记录区分、消息变化后的状态对齐、重复监听防护。其骰子实现有 `Math.random` 兜底，本版选择无 crypto 时跳过。

不适合直接沿用：完整技能/状态/分支/3D 骰子包、STX 宿主耦合与宿主存储。其部分 fallback 名称（如 `chat_changed`、`CHAT_RESET`、`CHAT_NEW`）不能当作当前标准酒馆接口契约；当前标准 `CHAT_CHANGED` 的实际值是 `chat_id_changed`。不把其 generation-ended 的结算假设用于本版消费成功判断。该参考包并没有提供本任务需要的独立副 AI 候选池链路。

## 2. st-direct-event-main

[仓库](https://github.com/Willhamster/st-direct-event-main) · 核实文件：`manifest.json`、`README.md`、`index.js`；Git tree `f87b5cb0550922243a02fae62c5dfe5026cad987`，manifest 版本 0.7.12。

其标准扩展用 `SillyTavern.getContext()`、`setExtensionPrompt` 和原生生成/消息事件，提供副请求、隐藏分轮“小纸条”、聊天状态与丰富 UI。生成开始时记录聊天身份及类型；regenerate/swipe/continue 根据 Assistant 标记恢复原来的轮次条件。发送后的全局回调会核对聊天身份，避免迟到结果串台。

值得借鉴：一次规划、多轮使用；隐藏上下文；重生成复用 Assistant 标记；停止标记；注入清除；对 MESSAGE_RECEIVED 与 GENERATION_ENDED 重复通知的防护。本版简化为独立候选池与一个回合一个情境，不沿用连续剧本。

不适合直接沿用：独立 API URL/Key、`/proxy/` 与浏览器直连适配、巨大输出上限、破限小说文本、长期暗箱/多分支结局、写入用户消息的事件标记正文。前几项未必已过时，但与本任务“复用酒馆 API、轻量起因、不改聊天正文”的约束不符。README 中的推荐模型与安装仓库 URL不能作为本插件的依赖或安装地址。

## 3. 酒馆助手的实际能力

[酒馆助手公开接口](https://github.com/N0VI028/JS-Slash-Runner/blob/main/%40types/function/generate.d.ts) 支持 `generate`/`generateRaw`、近期历史限制、注入、请求唯一 ID、静默生成和按请求停止，具备实现副 AI 的能力；并非“脚本不能调用 AI”。也有事件和聊天变量接口。

但是本目录不能确认酒馆助手已安装。脚本部署会增加助手版本和 iframe 运行/销毁生命周期依赖。关键主生成逻辑需要在酒馆实际发送用户消息之后、构建提示词之前执行，并同时支持文本/聊天补全、dry-run、重生成、群聊与错误收尾。直接采用标准 Extension 的 manifest 生成拦截器与聊天 metadata，可以使用酒馆原生接线；无需为脚本桥接到父页面或修改宿主行为。

**最终选择：小型标准第三方 Extension。** 依据是可直接使用现成的生成生命周期和保存接口、无额外运行依赖、原始文件即可安装，绝非为了形式“更正式”。脚本方案也可能实现这些能力；这里选择更少宿主依赖、便于验证的生命周期实现。

## 4. 核实的当前标准酒馆接口

源码以 [SillyTavern release](https://github.com/SillyTavern/SillyTavern/tree/release) 为准：

- [`st-context.js`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/st-context.js)：`chatMetadata`、`saveMetadata`、`setExtensionPrompt`、`eventTypes`、`ChatCompletionService`、`TextCompletionService`。
- [`extensions.js`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/extensions.js)：manifest `generate_interceptor` 对应 `globalThis` 函数，参数 `(chat, contextSize, abort, type)`，真实生成时在核心提示词构建前调用；本版从不调用 abort。
- [`events.js`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/events.js)：采用真实公开枚举，不猜测旧事件名。
- [`script.js`](https://github.com/SillyTavern/SillyTavern/blob/release/public/script.js)：生成开始发生在本次用户消息写入之前；regenerate 可删除旧 Assistant；流式正常收尾可先发 generation-ended 再发 message-received，流式错误也会发 message-received。故本版在 interceptor 绑定用户消息，在 start 捕获重放快照，在 receive 额外检查中止状态。
- [`custom-request.js`](https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/custom-request.js)：独立服务可生成当前配置请求载荷、覆盖单次模型和传入 AbortSignal，不必改全局模型或新建 API 客户端。

没有机械复制两个参考项目的代码；本包为针对任务约束重新编写的实现。`.research` 是工作区的参考源码快照，不是运行依赖，也不进入扩展安装包。
