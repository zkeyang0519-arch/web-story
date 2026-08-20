export const VISUAL_SKILLS_STORYBOARD_START = "【Visual Skills 四幕分镜提示词汇总】";
export const VISUAL_SKILLS_STORYBOARD_END = "【Visual Skills 汇总结束】";

export type VisualSkillsPromptFrame = {
  order: number;
  time_range: string;
  title: string;
  narrative_goal: string;
  prompt: string;
  motion: string;
};

type ActSection = {
  act: number;
  start: number;
  end: number;
  text: string;
};

const ACT_NUMBERS: Record<string, number> = {
  "一": 1,
  "二": 2,
  "三": 3,
  "四": 4,
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

const ACT_LABELS = ["一", "二", "三", "四"];

export function fourActTimeRanges(totalDuration: number) {
  const duration = Math.max(4, Math.round(totalDuration));
  const boundaries = [0, 1, 2, 3, 4].map((part) => Math.round(duration * part / 4));
  return boundaries.slice(0, 4).map((start, index) => `${start}-${boundaries[index + 1]}秒`);
}

export function withoutCompiledStoryboardSummary(value: string): string {
  const start = value.indexOf(VISUAL_SKILLS_STORYBOARD_START);
  if (start < 0) return value.trim();
  const end = value.indexOf(VISUAL_SKILLS_STORYBOARD_END, start);
  if (end < 0) return value.slice(0, start).trim();
  return `${value.slice(0, start)}${value.slice(end + VISUAL_SKILLS_STORYBOARD_END.length)}`.trim();
}

function actSections(value: string): { prefix: string; sections: ActSection[] } {
  const clean = withoutCompiledStoryboardSummary(value);
  const matches = [...clean.matchAll(/【第?(一|二|三|四|1|2|3|4)幕(?:[｜|][^】]*)?】/g)];
  const sections = matches.map((match, index) => {
    const start = match.index ?? 0;
    const end = matches[index + 1]?.index ?? clean.length;
    return {
      act: ACT_NUMBERS[match[1]] ?? 0,
      start,
      end,
      text: clean.slice(start, end).trim(),
    };
  });
  return {
    prefix: matches.length ? clean.slice(0, matches[0].index).trim() : clean,
    sections,
  };
}

function sectionIsComplete(section: ActSection, index: number) {
  if (section.act !== index + 1 || section.text.length < 80 || /(?:…|\.\.\.)\s*$/.test(section.text)) return false;
  if (index < 3) return /尾帧|结束画面|衔接|切镜头/.test(section.text);
  return /最终画面|尾帧|结束画面|结果|收束|停在/.test(section.text);
}

export function hasCompleteFourActScript(value: string) {
  const { sections } = actSections(value);
  if (sections.length < 4) return false;
  return sections.slice(0, 4).every(sectionIsComplete);
}

function clipAtSentence(value: string, max: number) {
  const text = value.trim();
  if (text.length <= max) return text;
  const window = text.slice(0, max);
  const candidates = [window.lastIndexOf("。"), window.lastIndexOf("；"), window.lastIndexOf("！"), window.lastIndexOf("？"), window.lastIndexOf("\n")];
  const boundary = Math.max(...candidates);
  return `${window.slice(0, boundary >= Math.floor(max * 0.55) ? boundary + 1 : max).trim()}（其余细节以对应分镜卡为准）`;
}

export function cleanStoryboardFramePrompt(value: string, fallback: string, max = 1200) {
  let text = value.trim();
  const embeddedJson = text.search(/(?:完整故事|完整项目|项目数据|资产分析)\s*[：:]\s*(?:\{|\[)/);
  if (embeddedJson >= 0) text = text.slice(0, embeddedJson).replace(/[。；\s]+$/, "");
  if (/^(?:\{|\[)/.test(text) || /"(?:continuity_anchor|asset_analysis|required_subjects)"\s*:/.test(text)) text = "";
  const safe = text.length >= 24 ? text : fallback.trim();
  return clipAtSentence(safe, max);
}

function frameAct(frame: VisualSkillsPromptFrame, continuity: string) {
  const actIndex = Math.max(0, Math.min(3, frame.order - 1));
  const visual = cleanStoryboardFramePrompt(frame.prompt, `${frame.narrative_goal}。${frame.motion}`, 1600);
  const transition = actIndex < 3
    ? "尾帧衔接：本幕最后一个镜头固定动作方向、视线、构图、主光与声音钩子；切镜头，直接进入下一幕。"
    : "最终画面：本幕最后一个镜头稳定停在完整故事结果和五锚点最终关系；切镜头至黑场，全片结束。";
  return `【第${ACT_LABELS[actIndex]}幕｜${frame.time_range}｜${frame.title}】\n叙事任务：${frame.narrative_goal}\n分镜执行：${visual}\n摄影机、动作与尾帧：${frame.motion}\n连续性：${continuity}\n${transition}`;
}

function alignActTimeRanges(value: string, frames: VisualSkillsPromptFrame[]) {
  return withoutCompiledStoryboardSummary(value).replace(/【第?(一|二|三|四|1|2|3|4)幕(?:[｜|][^】]*)?】/g, (header, label: string) => {
    const act = ACT_NUMBERS[label] ?? 0;
    const expected = frames[act - 1]?.time_range;
    if (!expected) return header;
    const parts = header.slice(1, -1).split(/[｜|]/);
    const timeIndex = parts.findIndex((part) => /\d+(?:\.\d+)?\D+\d+(?:\.\d+)?秒?/.test(part));
    if (timeIndex >= 0) parts[timeIndex] = expected;
    else parts.splice(1, 0, expected);
    return `【${parts.join("｜")}】`;
  });
}

export function buildFrameBasedFourActFallback(args: {
  duration: number;
  ratio: string;
  resolution: string;
  fps: number;
  visualDirection: string;
  assetRelationships: string;
  continuityAnchor: string;
  frames: VisualSkillsPromptFrame[];
}) {
  if (args.frames.length !== 4) throw new Error("总体提示词修复需要恰好4张分镜");
  const prefix = `【全局视觉圣经】\n成片规格：${args.duration}秒，${args.ratio}，${args.resolution}，${args.fps}fps。\n视觉与光色：${args.visualDirection}\n空间、资产与动作因果：${args.assetRelationships}\n五个全片锚点与连续性：${args.continuityAnchor}\n全片由恰好4个连续片段组成，每幕保持同一主体身份、服装、空间轴线、主光方向和道具状态；每幕包含清晰动作、物理反馈、声音锚点和最终画面。`;
  return [prefix, ...args.frames.map((frame) => frameAct(frame, args.continuityAnchor))].join("\n\n");
}

export function repairFourActScript(value: string, fallback: string) {
  const clean = withoutCompiledStoryboardSummary(value);
  if (hasCompleteFourActScript(clean)) return clean;

  const current = actSections(clean);
  const replacement = actSections(fallback);
  if (!hasCompleteFourActScript(fallback)) throw new Error("总体提示词必须包含按顺序完整书写的第一幕、第二幕、第三幕和第四幕");

  let preservedCount = 0;
  while (preservedCount < 4 && current.sections[preservedCount] && sectionIsComplete(current.sections[preservedCount], preservedCount)) {
    preservedCount += 1;
  }

  const prefix = current.prefix || replacement.prefix;
  const preserved = current.sections.slice(0, preservedCount).map((section) => section.text);
  const repaired = replacement.sections.slice(preservedCount, 4).map((section) => section.text);
  const result = [prefix, ...preserved, ...repaired].filter(Boolean).join("\n\n");
  if (!hasCompleteFourActScript(result)) throw new Error("总体提示词四幕修复失败");
  return result;
}

export function compileVisualSkillsPrompt(args: {
  script: string;
  fallbackScript: string;
  header: string;
  frames: VisualSkillsPromptFrame[];
}) {
  if (args.frames.length !== 4 || args.frames.some((frame, index) => frame.order !== index + 1)) {
    throw new Error("总体提示词汇总需要顺序为1到4的四张分镜");
  }
  const basePrompt = repairFourActScript(
    alignActTimeRanges(args.script, args.frames),
    alignActTimeRanges(args.fallbackScript, args.frames),
  );
  const storyboard = args.frames.map((frame) => [
    `【分镜${frame.order}｜${frame.time_range}｜${frame.title}】`,
    `叙事功能：${clipAtSentence(frame.narrative_goal, 400)}`,
    `关键帧提示词：${cleanStoryboardFramePrompt(frame.prompt, `${frame.narrative_goal}。${frame.motion}`)}`,
    `动作、运镜与尾帧：${clipAtSentence(frame.motion, 600)}`,
  ].join("\n")).join("\n\n");
  const compiled = [
    basePrompt,
    VISUAL_SKILLS_STORYBOARD_START,
    args.header,
    storyboard,
    VISUAL_SKILLS_STORYBOARD_END,
  ].filter(Boolean).join("\n\n");
  if (!hasCompleteFourActScript(compiled)) throw new Error("总体提示词汇总后缺少完整四幕");
  return compiled;
}
