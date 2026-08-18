# 镜流真实生成环境配置

这套配置把 3001 项目从演示适配器切换到火山方舟真实生成。API Key 只放在服务端环境中，不要粘贴到聊天、前端代码或 Git 仓库。

## 1. 开通模型

在火山方舟控制台完成实名认证、余额或资源包配置，并确认当前账号可以调用：

- 视频理解/结构化文本：Doubao Seed 2.0 Lite 与 Doubao Seed 2.1 Pro
- 创意融合与资产描述修改：Doubao Seed 2.1 Pro（或账号已开通的其他方舟文本模型）
- 图片生成：Doubao Seedream 5.0
- 视频生成：Doubao Seedance 2.0、2.0 Fast、2.0 Mini

控制台入口：<https://console.volcengine.com/ark/region:ark+cn-beijing/apikey>

模型版本会更新。如果控制台为你的账号显示的是 Endpoint ID 或不同版本号，请用控制台值覆盖 `.dev.vars` 中对应的方舟模型变量，不需要修改业务代码。

## 2. 本地配置文件

编辑项目根目录的 `.dev.vars`，填写下面这些真实值：

```dotenv
ARK_API_KEY=你的火山方舟APIKey
ARK_ANALYSIS_MODEL=控制台显示的视觉理解ModelID或EndpointID
ARK_REVIEW_MODEL=控制台显示的文本整合ModelID或EndpointID
```

其余模型 ID 已经写好。三个下拉视频模型分别读取：

| 界面选项 | 环境变量 |
| --- | --- |
| Seedance 2.0 Standard | `ARK_VIDEO_MODEL` |
| Seedance 2.0 Fast | `ARK_VIDEO_MODEL_FAST` |
| Seedance 2.0 Mini | `ARK_VIDEO_MODEL_MINI` |

`.dev.vars` 已被 `.gitignore` 排除，不会进入版本库。`.dev.vars.example` 是不含密钥的团队模板。

## 3. 检查并启动

在 `D:\agent\web-story` 运行：

```powershell
npm run production:check
npm run dev
```

修改 `.dev.vars` 后必须重启 3001 服务。然后打开：

```text
http://localhost:3001/api/system
```

只有同时出现以下结果才算准备完成：

```json
{
  "mode": "production",
  "ready": true,
  "storage": true
}
```

随后必须新建任务并重新上传参考视频。已有 `runMode: demo` 或 `mock_` 的任务不会转换为真实任务。

## 4. 托管环境

`.openai/hosting.json` 已声明：

- D1 逻辑绑定：`DB`，保存项目、状态和审核数据
- R2 逻辑绑定：`MEDIA`，保存上传视频、分镜图、分段视频和最终 MP4

托管时不要上传 `.dev.vars`。在 Sites 的服务端运行时变量/Secrets 中添加与 `.dev.vars.example` 同名的全部变量，并把 `ARK_API_KEY` 标记为 Secret。D1 和 R2 由 Sites 根据 `.openai/hosting.json` 创建并绑定，不需要把 Cloudflare 资源密钥写入代码。

## 5. 第一次真实任务检查

第一次建议用 15 秒、480p 或 720p 做低成本冒烟测试。依次确认：

1. 每条参考视频得到不同的摘要和时间线，不再出现统一 86% 演示文本。
2. 方舟文本模型返回 3 个不同策略的候选故事，来源追踪中能看到参考素材描述、原创变形和落地用途。
3. 每项资产卡各有一张真实资产图，随后 Seedream 再返回 4 张真实分镜图，R2 中存在对应对象。
4. Seedance 返回真实任务 ID，不以 `mock_` 开头。
5. 交付结果包含 `result.videoUrl`，页面可以播放并下载 MP4。

如果失败，制作进度页会保留已完成的上游结果，并显示当前失败步骤；不要反复新建高分辨率任务，以免重复计费。
