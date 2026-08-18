import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the Jingliu production studio", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>镜流 · 故事资产工作台<\/title>/);
  assert.match(html, /先给我看/);
  assert.match(html, /参考素材/);
  assert.match(html, /下一步：创作要求/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("keeps production capabilities declared", async () => {
  const [hosting, page, schema] = await Promise.all([
    readFile(new URL("../.openai/hosting.json", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/schema.ts", import.meta.url), "utf8"),
  ]);
  assert.match(hosting, /"d1": "DB"/);
  assert.match(hosting, /"r2": "MEDIA"/);
  assert.match(page, /演示环境/);
  assert.match(page, /生产模式下下载 MP4/);
  assert.match(schema, /projects/);
  assert.match(schema, /uploads/);
});

test("offers a fresh independent project after delivery", async () => {
  const studio = await readFile(new URL("../app/studio.tsx", import.meta.url), "utf8");
  assert.match(studio, /async function startNewVideo\(\)/);
  assert.match(studio, /body: JSON\.stringify\(\{ action: "draft", requestKey \}\)/);
  assert.match(studio, /window\.location\.assign\(`\/projects\/\$\{data\.project\.id\}\/references`\)/);
  assert.match(studio, /开始生成新视频/);
  assert.match(studio, /本次成片与制作记录会保留/);
});

test("keeps every paid generation stage behind the four review gates", async () => {
  const [pipeline, projectRoute, reviewUi, referenceInspector, cost] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/references/inspect/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cost.ts", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /awaiting_creative_review/);
  assert.match(pipeline, /awaiting_image_plan/);
  assert.match(pipeline, /awaiting_asset_image_review/);
  assert.match(pipeline, /awaiting_canvas_review/);
  assert.match(pipeline, /role: "reference_image"/);
  assert.match(pipeline, /reviewStoryboardImages/);
  assert.match(pipeline, /reviewVideoSegment/);
  assert.match(pipeline, /23 \* 60 \* 60 \* 1000/);
  assert.match(projectRoute, /"awaiting_review"/);
  assert.match(reviewUi, /资产占位图/);
  assert.match(reviewUi, /onClick=\{confirmImagePlan\}/);
  assert.match(reviewUi, /onClick=\{confirmAssetImages\}/);
  assert.match(reviewUi, /onClick=\{confirmCanvas\}/);
  assert.match(referenceInspector, /REFERENCE_VIDEO_UNAVAILABLE/);
  assert.match(cost, /storyboard: \{ count: number; assetCountMin: number; assetCountMax: number/);
});

test("keeps Great Writer story review separate from video-script assets", async () => {
  const [pipeline, reviewUi, studio, creativeCardRoute, approveRoute] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/projects/[id]/creative-card/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/approve/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pipeline, /story_options/);
  assert.match(pipeline, /selected_story_id/);
  assert.match(pipeline, /storyOptions\.length !== 1/);
  assert.match(pipeline, /Great Writer 阶段必须恰好包含1篇创意故事/);
  assert.match(pipeline, /GREAT_WRITER_CREATIVE_STORY_REFERENCE/);
  assert.match(pipeline, /great-writer\.creative-writing\.v1/);
  assert.match(pipeline, /此阶段禁止生成镜头表、视频脚本、分镜或资产清单/);
  assert.match(pipeline, /shot_plan: undefined/);
  assert.match(pipeline, /assets: undefined/);
  assert.match(pipeline, /创意资产标识不能重复/);
  assert.match(pipeline, /asset_cards/);
  assert.match(pipeline, /usable_material_descriptions/);
  assert.match(pipeline, /creative_opportunities/);
  assert.match(pipeline, /source_description/);
  assert.match(pipeline, /creative_transformation/);
  assert.match(pipeline, /story_usage/);
  assert.match(pipeline, /confirmed_asset_ids/);
  assert.match(pipeline, /overview_confirmed/);
  assert.match(pipeline, /planning_storyboard/);
  assert.match(pipeline, /STORYBOARD_PLAN_TOOL_NAME = "submit_storyboard_frames"/);
  assert.match(pipeline, /现在才进入 AI 视频详细脚本阶段/);
  assert.match(pipeline, /lockConfirmedStoryInImagePlan/);
  assert.match(pipeline, /故事锁定规则/);
  assert.match(pipeline, /imagePlan\.overview\.story/);
  assert.match(pipeline, /asset_cards 必须包含2到12项必要资产/);
  assert.match(pipeline, /AI 视频详细脚本/);
  assert.match(pipeline, /已确认资产卡/);

  const referenceIndex = reviewUi.indexOf("原参考视频解析");
  const storyIndex = reviewUi.indexOf("创意故事生成与修改");
  assert.ok(referenceIndex >= 0 && referenceIndex < storyIndex);
  assert.equal(reviewUi.indexOf("创意素材资产拆分"), -1);
  assert.match(reviewUi, /确认故事，生成 AI 视频详细脚本/);
  assert.match(reviewUi, /已确认故事（锁定）/);
  assert.ok(reviewUi.indexOf('data-review-order="creative-overview"') > reviewUi.indexOf('className="asset-creative-card-section"'));
  assert.match(reviewUi, /确认本资产/);
  assert.match(reviewUi, /我已检查详细视频脚本、资产关系与全局一致性/);
  assert.match(studio, /planning_images.*creative-card/);
  assert.match(studio, /planning_storyboard.*creative-card/);
  assert.match(reviewUi, /confirmed_asset_ids: imagePlan\.asset_cards\.map/);
  assert.match(reviewUi, /"failed", "cancelled", "needs_action"/);
  assert.match(approveRoute, /status: 422/);
  assert.match(creativeCardRoute, /ReviewWorkflow view="images"/);
});

test("revises one asset from user feedback and regenerates rejected storyboards", async () => {
  const [pipeline, reviewUi, reviseRoute, regenerateAssetImageRoute, studio] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/revise-asset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/regenerate-asset-image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(reviewUi, /给 AI 的修改意见/);
  assert.match(reviewUi, /根据修改意见重新生成资产描述/);
  assert.match(reviewUi, /"regenerate-asset-image" : "revise-asset"/);
  assert.match(pipeline, /ASSET_REVISION_TOOL_NAME = "submit_revised_asset_description"/);
  assert.match(pipeline, /export async function reviseAssetCardWithFeedback/);
  assert.match(reviseRoute, /reviseAssetCardWithFeedback/);
  assert.match(reviseRoute, /state\.revision !== body\.revision/);
  assert.match(reviewUi, /根据修改意见重新生成本资产图片/);
  assert.match(reviewUi, /regenerate-asset-image/);
  assert.match(reviewUi, /其他资产不会重新生成/);
  assert.match(pipeline, /export async function regenerateAssetImageWithFeedback/);
  assert.match(pipeline, /assetImages\.map\(\(image\) => image\.assetId === args\.assetId \? replacement : image\)/);
  assert.match(pipeline, /await generateAssetReferenceImage\(args\.input, imagePlan, revisedAsset/);
  assert.match(regenerateAssetImageRoute, /state\.phase !== "awaiting_asset_image_review"/);
  assert.match(regenerateAssetImageRoute, /regenerateAssetImageWithFeedback/);
  const continuityIndex = reviewUi.indexOf("一致性要求");
  const feedbackIndex = reviewUi.indexOf("给 AI 的修改意见");
  const regenerateIndex = reviewUi.indexOf("根据修改意见重新生成资产描述");
  const confirmIndex = reviewUi.indexOf("确认本资产");
  assert.ok(continuityIndex >= 0 && continuityIndex < feedbackIndex && feedbackIndex < regenerateIndex && regenerateIndex < confirmIndex);
  assert.match(reviewUi, /trim\(\)\.length \?\? 0\) < 2/);

  assert.match(pipeline, /resumePhase: "generating_images"/);
  assert.match(pipeline, /"planning_storyboard", "generating_images", "reviewing_images"/);
  assert.match(pipeline, /generating_images: "generating_assets"/);
  assert.match(pipeline, /priorQualityFailure/);
  assert.match(pipeline, /regenerationFeedback/);
  assert.match(pipeline, /不要重复上轮被指出的动作、道具、位置或连续性错误/);
  assert.match(pipeline, /storyboardImages: regenerateStoryboard \? undefined/);
  assert.match(studio, /按质检意见重新生成分镜/);
  assert.match(studio, /project\.pipelinePhase === "generating_images"/);
  assert.match(studio, /!project\.keyframeUrl && !isPaused/);
});

test("regenerates the single Great Writer story from user feedback", async () => {
  const [pipeline, reviewUi, reviseCreativeRoute] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/revise-creative-item/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pipeline, /setup、turn、payoff 合计形成约一章长度/);
  assert.match(pipeline, /scene-first，展示而非解释/);
  assert.match(pipeline, /STORY_REVISION_TOOL_NAME = "submit_revised_creative_story"/);
  assert.match(pipeline, /export async function reviseCreativeReviewItemWithFeedback/);
  assert.match(reviewUi, /给 AI 的故事修改意见/);
  assert.match(reviewUi, /根据修改意见重新生成本故事/);
  assert.match(reviewUi, /不会提前生成镜头或资产/);
  assert.doesNotMatch(reviewUi, /给 AI 的资产修改意见/);
  assert.match(reviewUi, /\/revise-creative-item/);
  assert.match(reviewUi, /draftCreative: creative/);
  assert.match(reviewUi, /draftAnalyses: analyses/);
  assert.match(reviseCreativeRoute, /state\.phase !== "awaiting_creative_review"/);
  assert.match(reviseCreativeRoute, /state\.revision !== body\.revision/);
  assert.match(reviseCreativeRoute, /reviseCreativeReviewItemWithFeedback/);
});

test("uses Volcengine Ark Responses for text integration", async () => {
  const [pipeline, configTemplate, productionCheck] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../.dev.vars.example", import.meta.url), "utf8"),
    readFile(new URL("../scripts/check-production-config.mjs", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(configTemplate, /GLM_/);
  assert.doesNotMatch(productionCheck, /GLM_/);
  assert.match(pipeline, /provider: production \? "火山方舟"/);
  assert.match(pipeline, /model: ark\.reviewModel, strategy: "primary"/);
  assert.match(pipeline, /tools: \[ASSET_REVISION_TOOL\]/);
  assert.match(pipeline, /toolName: ASSET_REVISION_TOOL_NAME/);
  assert.match(pipeline, /operation: "asset_description_revision"/);
});

test("replaces each asset placeholder with its own archived image without changing the card layout", async () => {
  const [pipeline, reviewUi, projectView, approveRoute, cost] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/approve/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/cost.ts", import.meta.url), "utf8"),
  ]);

  assert.match(pipeline, /async function generateAssetReferenceImages/);
  assert.match(pipeline, /assetId: asset\.id/);
  assert.match(pipeline, /\/assets\/r\$\{revision\}/);
  assert.match(pipeline, /phase: "awaiting_asset_image_review"/);
  assert.match(approveRoute, /"asset_images"/);
  assert.match(projectView, /pipeline\?\.assetImages/);
  assert.match(reviewUi, /const assetImageById = new Map/);
  assert.match(reviewUi, /assetImage\?\.url \? <Image/);
  assert.match(reviewUi, /图片只替换原占位框/);
  assert.doesNotMatch(reviewUi, /className="storyboard-result-section"/);
  assert.match(cost, /assetCountMin = 2/);
  assert.match(cost, /assetCountMax = 12/);
});

test("renders both review entry routes", async () => {
  const [fusionResponse, creativeCardResponse] = await Promise.all([
    render("/projects/demo/creative-review"),
    render("/projects/demo/creative-card"),
  ]);
  assert.equal(fusionResponse.status, 200);
  assert.equal(creativeCardResponse.status, 200);
});

test("recovers Great Writer story generation without repeating video analysis", async () => {
  const [pipeline, projectRoute, retryRoute, studio] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/retry-creative/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /submit_creative_card/);
  assert.match(pipeline, /additionalProperties: false/);
  assert.match(pipeline, /creative_card\.v2/);
  assert.match(pipeline, /strategy: "repair"/);
  assert.match(pipeline, /strategy: "fallback"/);
  assert.match(pipeline, /CreativeStructureInvalid/);
  const validatorStart = pipeline.indexOf("function validateGeneratedCreativeCard");
  const analysisCountDeclaration = pipeline.indexOf("const analysisCount = analyses.length", validatorStart);
  const writingTraceValidation = pipeline.indexOf("const writingTrace = source.writing_trace", validatorStart);
  assert.ok(analysisCountDeclaration > validatorStart && analysisCountDeclaration < writingTraceValidation);
  assert.equal(pipeline.indexOf("const shots = source.shot_plan", validatorStart), -1);
  assert.match(pipeline, /function buildEditableCreativeFallback/);
  assert.match(pipeline, /fallbackApplied: true/);
  assert.match(pipeline, /系统已自动整理为可编辑创意草稿/);
  assert.match(projectRoute, /"needs_action"/);
  assert.match(retryRoute, /retryCreativeSynthesis/);
  assert.match(studio, /仅重试 Great Writer 故事/);
});

test("persists structured-output diagnostics and supports step-only recovery", async () => {
  const [pipeline, retryRoute, projectView, studio] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/retry-step/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-view.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/studio.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /PipelineDiagnosticLog/);
  assert.match(pipeline, /responseExcerpt/);
  assert.match(pipeline, /providerResponseId/);
  assert.match(pipeline, /IMAGE_PLAN_TOOL_NAME = "submit_image_plan"/);
  assert.match(pipeline, /retryRecoverableStep/);
  assert.match(retryRoute, /retryRecoverableStep/);
  assert.match(projectView, /visibleDiagnostics/);
  assert.match(studio, /流程诊断日志/);
  assert.match(studio, /下载完整流程日志 JSON/);
  assert.match(studio, /仅重试当前步骤/);
});

test("auto-organizes ordinary model prose for every editable text-authoring stage", async () => {
  const pipeline = await readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8");
  assert.match(pipeline, /function organizeEditableResponse/);
  assert.match(pipeline, /error instanceof PipelineStepFailure\) return fallback\(\)/);
  assert.match(pipeline, /buildEditableReferenceAnalysisFallback\(response, index, reference\)/);
  assert.match(pipeline, /buildEditableImagePlanFallback\(input, creative, response\)/);
  assert.match(pipeline, /buildEditableStoryRevisionFallback\(currentStory, feedback, response\)/);
  assert.match(pipeline, /buildEditableCreativeAssetRevisionFallback\(currentAsset, feedback, response\)/);
  assert.match(pipeline, /buildEditableAssetCardRevisionFallback\(currentAsset, feedback, response\)/);
  assert.match(pipeline, /buildEditableOverviewRevisionFallback\(args\.input, current, args\.state\.imagePlan!, feedback, response\)/);
  assert.match(pipeline, /buildEditableStoryboardFallback\(input, imagePlan, response\)/);
  assert.match(pipeline, /buildEditableVideoPlanFallback\(input, creative, imagePlan, response\)/);

  const strictCalls = [...pipeline.matchAll(/return parseStructuredResponse\(response, \{[\s\S]*?operation: "([^"]+)"/g)]
    .map((match) => match[1]);
  assert.deepEqual(strictCalls, ["storyboard_quality_review", "video_segment_quality_review"]);
});

test("adds AI overview revision and a reusable cinematic script blueprint", async () => {
  const [pipeline, reviewUi, overviewRoute, projectView] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/revise-overview/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/project-view.ts", import.meta.url), "utf8"),
  ]);
  assert.match(pipeline, /const CINEMATIC_SCRIPT_REFERENCE/);
  assert.match(pipeline, /世界规则 \+ 主体设定 \+ 空间关系 \+ 时间动作 \+ 摄影机 \+ 光色 \+ 物理反馈 \+ 分层声音 \+ 硬约束/);
  assert.match(pipeline, /全局视觉圣经/);
  assert.match(pipeline, /恰好4幕的完整执行脚本/);
  assert.match(pipeline, /cinematic_script: \{ type: "string"/);
  assert.match(pipeline, /operation: "creative_overview_revision"/);
  assert.match(pipeline, /固定参考方法：\$\{CINEMATIC_SCRIPT_REFERENCE\}/);
  assert.match(pipeline, /脚本拆段时继续遵循：\$\{CINEMATIC_SCRIPT_REFERENCE\}/);
  assert.match(reviewUi, /供 AI 生成视频的详细脚本/);
  assert.match(reviewUi, /给 AI 的总览修改意见/);
  assert.match(reviewUi, /\/revise-overview/);
  assert.match(overviewRoute, /reviseCreativeOverviewWithFeedback/);
  assert.match(projectView, /cinematic_script:/);
});

test("keeps every review textbox editable and persists post-generation edits", async () => {
  const [pipeline, reviewUi, reviseAssetRoute, regenerateAssetRoute] = await Promise.all([
    readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/review-workflow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/revise-asset/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/projects/[id]/regenerate-asset-image/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(reviewUi, /const assetTextFieldsLocked = generatingAssetImages \|\| planningStoryboard \|\| generatingImages \|\| imagesReady/);
  assert.doesNotMatch(reviewUi, /readOnly=\{creativeCardLocked\}/);
  assert.match(reviewUi, /readOnly=\{assetTextFieldsLocked\}/);
  assert.match(reviewUi, /image_plan: imagePlan/);
  assert.match(reviewUi, /draftImagePlan: imagePlan/);
  assert.match(reviewUi, /所有文字字段仍可直接修改/);
  assert.match(pipeline, /payload\.image_plan\s*\?\s*normalizeImagePlan/);
  assert.match(pipeline, /phase: "planning_storyboard",\s*imagePlan,/);
  assert.match(reviseAssetRoute, /draftImagePlan: body\.draftImagePlan/);
  assert.match(regenerateAssetRoute, /draftImagePlan: body\.draftImagePlan/);
});

function probeVideoConfig() {
  const moduleUrl = new URL("../lib/video-config.ts", import.meta.url).href;
  const script = `
    import * as config from ${JSON.stringify(moduleUrl)};
    const presets = [15, 30, 45, 60, 90, 120];
    const segmentPlans = Object.fromEntries(presets.map((duration) => [duration, config.segmentDurations(duration)]));
    const validate = (videoModel, resolution, fps = 24) => config.validateVideoSpec({
      duration: 30,
      videoModel,
      ratio: "9:16",
      resolution,
      fps,
    }).ok;
    process.stdout.write(JSON.stringify({
      models: config.VIDEO_MODEL_KEYS,
      ratios: config.VIDEO_RATIOS,
      fps: config.VIDEO_FPS_OPTIONS,
      profiles: Object.fromEntries(config.VIDEO_MODEL_KEYS.map((key) => [key, config.VIDEO_MODEL_PROFILES[key].resolutions])),
      segmentPlans,
      standard4k: validate("seedance-2.0-standard", "4k"),
      fast1080: validate("seedance-2.0-fast", "1080p"),
      mini1080: validate("seedance-2.0-mini", "1080p"),
      unsupportedFps: validate("seedance-2.0-standard", "1080p", 30),
    }));
  `;
  const result = spawnSync(process.execPath, [
    "--no-warnings",
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    script,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("declares the Seedance 2.0 capability matrix and rejects unsupported combinations", () => {
  const probe = probeVideoConfig();
  assert.deepEqual(probe.models, [
    "seedance-2.0-standard",
    "seedance-2.0-fast",
    "seedance-2.0-mini",
  ]);
  assert.deepEqual(probe.ratios, ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]);
  assert.deepEqual(probe.fps, [24]);
  assert.ok(probe.profiles["seedance-2.0-standard"].includes("4k"));
  assert.deepEqual(probe.profiles["seedance-2.0-fast"], ["480p", "720p"]);
  assert.deepEqual(probe.profiles["seedance-2.0-mini"], ["480p", "720p"]);
  assert.equal(probe.standard4k, true);
  assert.equal(probe.fast1080, false);
  assert.equal(probe.mini1080, false);
  assert.equal(probe.unsupportedFps, false);
});

test("splits every selectable long duration into valid Seedance clips with an exact total", () => {
  const { segmentPlans } = probeVideoConfig();
  for (const duration of [15, 30, 45, 60, 90, 120]) {
    const clips = segmentPlans[duration];
    assert.equal(clips.reduce((total, clip) => total + clip, 0), duration);
    assert.equal(clips.length, Math.ceil(duration / 15));
    assert.ok(clips.every((clip) => Number.isInteger(clip) && clip >= 4 && clip <= 15));
  }
});

test("validates selectable video settings without restoring the former fixed spec", async () => {
  const projectRoute = await readFile(new URL("../app/api/projects/[id]/route.ts", import.meta.url), "utf8");
  assert.match(projectRoute, /validateVideoSpec\s*\(\s*\{/);
  assert.match(projectRoute, /Object\.assign\(input, body\.data, videoSpec\.spec\)/);
  assert.doesNotMatch(projectRoute, /Number\(body\.data\.duration\)\s*!==\s*15/);
  assert.doesNotMatch(projectRoute, /Object\.assign\(input, body\.data, \{\s*ratio:\s*["']9:16["']\s*\}\)/);
});

test("plans, chains, quality-checks, and assembles long video segments", async () => {
  const pipeline = await readFile(new URL("../lib/pipeline.ts", import.meta.url), "utf8");
  const phases = [
    "planning_video_segments",
    "submitting_video",
    "polling_video",
    "reviewing_video",
    "assembling_video",
  ];
  const phaseIndexes = phases.map((phase) => pipeline.indexOf(`if (state.phase === "${phase}")`));
  assert.ok(phaseIndexes.every((index) => index >= 0));
  assert.deepEqual([...phaseIndexes].sort((a, b) => a - b), phaseIndexes);

  assert.match(pipeline, /previousLastFrameUrl\s*=\s*activeIndex\s*>\s*0[\s\S]*?\.lastFrameUrl/);
  assert.match(pipeline, /role:\s*["']first_frame["']/);
  assert.match(pipeline, /task\.content\.last_frame_url/);
  assert.match(pipeline, /return_last_frame:\s*true/);
  assert.match(pipeline, /import\s*\{\s*assembleVideoSegments\s*\}\s*from\s*["']@\/lib\/video-assembly["']/);
  assert.match(pipeline, /await\s+assembleVideoSegments\s*\(/);

  const requestStart = pipeline.indexOf("async function createSeedanceSegmentTask");
  const requestEnd = pipeline.indexOf("\nasync function archiveImage", requestStart);
  assert.ok(requestStart >= 0 && requestEnd > requestStart);
  const requestSource = pipeline.slice(requestStart, requestEnd);
  assert.match(requestSource, /model:\s*getArkVideoModel\(input\.videoModel/);
  assert.match(requestSource, /resolution:\s*input\.resolution/);
  assert.match(requestSource, /ratio:\s*input\.ratio/);
  assert.match(requestSource, /duration:\s*segment\.duration/);
  assert.doesNotMatch(requestSource, /\b(?:fps|frame_?rate|frames_per_second)\s*:/i);
});

test("renders five model-aware selectors and a dynamic long-form segment preview", async () => {
  const studio = await readFile(new URL("../app/studio.tsx", import.meta.url), "utf8");
  const settingsStart = studio.indexOf('{view === "spec" && <section');
  const settingsEnd = studio.indexOf('{view === "quote" && <section', settingsStart);
  assert.ok(settingsStart >= 0 && settingsEnd > settingsStart);
  const settingsSource = studio.slice(settingsStart, settingsEnd);

  assert.equal(settingsSource.match(/<select\b/g)?.length, 5);
  assert.match(settingsSource, /VIDEO_DURATION_OPTIONS\.map/);
  assert.match(settingsSource, /VIDEO_MODEL_KEYS\.map/);
  assert.match(settingsSource, /VIDEO_RATIOS\.map/);
  assert.match(settingsSource, /getSupportedResolutions\(videoModel\)\.map/);
  assert.match(settingsSource, /VIDEO_FPS_OPTIONS\.map/);
  assert.match(settingsSource, /selectedSegmentDurations\.map/);
  assert.match(settingsSource, /selectedDimensionLabel/);
  assert.match(studio, /setResolution\(\(current\)\s*=>\s*profile\.resolutions\.includes\(current\)/);
  assert.match(studio, /monitorRatioStyle\(ratio\)/);
});

test("hydrates and forwards the saved input at every approval gate", async () => {
  const approveRoute = await readFile(new URL("../app/api/projects/[id]/approve/route.ts", import.meta.url), "utf8");
  assert.match(approveRoute, /hydratePipelineInput\(JSON\.parse\(row\.inputJson\),\s*row\.id,\s*row\.title\)/);
  assert.match(approveRoute, /approvePipelineGate\(\{\s*state,\s*input,\s*gate:/);
});
