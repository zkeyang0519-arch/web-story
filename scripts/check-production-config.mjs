import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const varsPath = resolve(root, ".dev.vars");
const hostingPath = resolve(root, ".openai", "hosting.json");

function parseDotEnv(source) {
  const values = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
    values[key] = value;
  }
  return values;
}

let values;
try {
  values = parseDotEnv(readFileSync(varsPath, "utf8"));
} catch {
  console.error("FAIL: .dev.vars 不存在。请先复制 .dev.vars.example。\n");
  process.exit(1);
}

const required = [
  "PIPELINE_MODE",
  "ARK_API_KEY",
  "ARK_ANALYSIS_MODEL",
  "ARK_REVIEW_MODEL",
  "ARK_IMAGE_MODEL",
  "ARK_VIDEO_MODEL",
  "ARK_VIDEO_MODEL_FAST",
  "ARK_VIDEO_MODEL_MINI",
];
const missing = required.filter((key) => !values[key]);
const errors = [];

if (values.PIPELINE_MODE !== "production") {
  errors.push("PIPELINE_MODE 必须设为 production");
}
if (missing.length) {
  errors.push(`以下配置为空：${missing.join(", ")}`);
}
if (values.ARK_API_KEY && /^(your|replace|请填写|xxx)/i.test(values.ARK_API_KEY)) {
  errors.push("ARK_API_KEY 仍是占位值");
}
try {
  const hosting = JSON.parse(readFileSync(hostingPath, "utf8"));
  if (hosting.d1 !== "DB") errors.push(".openai/hosting.json 的 D1 绑定必须是 DB");
  if (hosting.r2 !== "MEDIA") errors.push(".openai/hosting.json 的 R2 绑定必须是 MEDIA");
} catch {
  errors.push("无法读取 .openai/hosting.json");
}

if (errors.length) {
  console.error("生产配置未就绪：");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("生产配置文件检查通过。");
console.log("下一步：重启 npm run dev，然后访问 http://localhost:3001/api/system 确认 mode=production、ready=true、storage=true。");
console.log("注意：该检查只验证本地配置完整性，不会调用模型，也不会产生费用。");
