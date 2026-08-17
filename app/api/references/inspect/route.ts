import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "@/db";
import { projects } from "@/db/schema";

export const dynamic = "force-dynamic";

const socialHosts = ["douyin.com", "iesdouyin.com", "xiaohongshu.com", "xhslink.com"];

function ownerId(request: Request) {
  return request.headers.get("oai-authenticated-user-id") ?? "local-preview";
}

function isAllowedHost(hostname: string) {
  const host = hostname.toLowerCase();
  return socialHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

function decodeEscapedUrl(value: string) {
  return value.replace(/\\u002[fF]/g, "/").replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

function findVideoUrl(html: string) {
  const patterns = [
    /<meta[^>]+(?:property|name)=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:video(?::url)?["']/i,
    /["'](?:masterUrl|videoUrl|downloadAddr|playAddr)["']\s*:\s*["']([^"']+)["']/i,
    /(https?:\\?\/\\?\/[^"'\s]+?\.(?:mp4|mov|webm)(?:\?[^"'\s]*)?)/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return decodeEscapedUrl(match[1]);
  }
  return null;
}

export async function POST(request: Request) {
  try {
    await ensureDatabase();
    const body = await request.json().catch(() => null) as { projectId?: string; url?: string } | null;
    if (!body?.projectId || !body.url) return Response.json({ error: "缺少项目或分享链接" }, { status: 400 });
    let url: URL;
    try { url = new URL(body.url); } catch { return Response.json({ error: "分享链接格式无效" }, { status: 400 }); }
    if (!['http:', 'https:'].includes(url.protocol)) return Response.json({ error: "仅支持 HTTP/HTTPS 链接" }, { status: 400 });
    const directVideo = /\.(mp4|mov|webm)$/i.test(url.pathname);
    if (!directVideo && !isAllowedHost(url.hostname)) {
      return Response.json({ error: "目前仅解析抖音、小红书或直接视频链接" }, { status: 400 });
    }

    const db = getDb();
    const [project] = await db.select({ id: projects.id }).from(projects).where(and(
      eq(projects.id, body.projectId),
      eq(projects.ownerId, ownerId(request)),
      eq(projects.status, "draft"),
    )).limit(1);
    if (!project) return Response.json({ error: "项目不存在或已经开始制作" }, { status: 404 });

    if (directVideo) {
      return Response.json({ reference: { status: "ready", source: "direct", resolvedUrl: url.toString(), directVideo: true } });
    }

    let resolvedUrl = url.toString();
    let extractedVideoUrl: string | null = null;
    let note = "分享链接已解析";
    try {
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; JingliuReferenceResolver/1.0)",
          accept: "text/html,application/xhtml+xml,video/*;q=0.8,*/*;q=0.5",
        },
      });
      resolvedUrl = response.url || resolvedUrl;
      const contentType = response.headers.get("content-type") ?? "";
      if (response.ok && contentType.startsWith("video/")) {
        extractedVideoUrl = resolvedUrl;
      } else if (response.ok && contentType.includes("text/html")) {
        extractedVideoUrl = findVideoUrl((await response.text()).slice(0, 3_000_000));
      } else {
        note = "已识别分享链接；平台限制了页面抓取，生成阶段将使用链接信息继续处理";
      }
    } catch {
      note = "已识别分享链接；平台限制了自动访问，生成阶段将使用链接信息继续处理";
    }

    const source = /xiaohongshu|xhslink/i.test(resolvedUrl) ? "xiaohongshu" : "douyin";
    return Response.json({
      reference: {
        status: "ready",
        source,
        resolvedUrl: extractedVideoUrl || resolvedUrl,
        directVideo: Boolean(extractedVideoUrl),
        note,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "链接解析失败" }, { status: 500 });
  }
}
