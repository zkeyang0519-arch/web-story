# 镜流 · AI 短视频工坊

内部团队使用的一键成片 MVP。用户添加 1～10 个参考视频，填写主题、目标观众与成片规格，确认预计平台成本后，系统才通过统一管线完成参考解析、创意收敛、Seedream 首帧生成、Seedance 2.0 图生视频、质量检查与后期交付。

## 当前版本

- 五页顺序式制作：参考素材 → 创作要求 → 成片设置 → 制作监看 → 成片交付
- 每一步先保存 D1 草稿，再进入下一页；刷新、前后退和直接访问都能恢复正确步骤
- D1 持久化项目与上传记录
- R2 存储参考视频与成片
- 参考视频采用 R2 分片上传，不设置 200 MB 的应用层大小上限
- 统一管线适配器：无生产配置时使用可识别的演示模式；配置火山方舟 Key 后自动切换真实模式
- 默认成片规格：9:16、1080 × 1920、24 fps、Seedance 2.0 Standard
- 成本确认是硬闸门：未确认时不启动参考视频 AI 解析或 Seedance 生成
- 内部私有部署，不在浏览器保存供应商密钥

演示模式用于验收页面、状态与交付链路，不会伪装成真实模型输出，也不会产生火山引擎费用。

## 本地运行

```bash
npm install
npm run dev
```

验证：

```bash
npm run lint
npm test
```

## 生产管线配置

站点通过服务端环境变量直接连接火山方舟：

- `ARK_API_KEY`（必填，仅服务端 Secret）
- `ARK_ANALYSIS_MODEL`（可选，默认 `doubao-seed-2-0-lite-260428`）
- `ARK_REVIEW_MODEL`（可选，默认 `doubao-seed-2-1-pro-260628`）
- `ARK_CREATIVE_FALLBACK_MODELS`（可选，使用英文逗号分隔备用模型或 Endpoint ID；未配置时回退到解析模型）
- `ARK_IMAGE_MODEL`（可选，默认 `doubao-seedream-5-0-lite-260128`）
- `ARK_VIDEO_MODEL`（可选，默认 `doubao-seedance-2-0-260128`）

真实模式会把上传的视频流式送入方舟 Files API，由视觉模型逐条解析。创意融合通过 Function Calling 输出 `creative_card.v1`，依次执行本地结构/时间轴/来源/约束校验、同模型定向修复和备用模型重试；最终仍失败时保留解析结果，允许只重试创意融合。用户确认分镜后再异步提交 Seedance 2.0 Standard。成片成功后立即归档到 R2，并按方舟返回的 token 用量回填平台成本。
