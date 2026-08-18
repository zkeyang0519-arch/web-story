import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3001"),
  title: "镜流 · 故事资产工作台",
  description: "从参考视频解析、创意小故事到可编辑资产创意卡的 AI 制片工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "镜流 · 故事资产工作台",
    description: "先把参考素材讲成故事，再拆成可编辑创意资产。",
    images: ["/og-story-card.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
