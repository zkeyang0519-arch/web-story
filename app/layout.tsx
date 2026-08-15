import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "镜流 · AI 短视频工坊",
  description: "从参考视频到可交付成片的一站式 AI 制片工作台。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "镜流 · AI 短视频工坊",
    description: "参考视频进，成片出。",
    images: ["/og-card.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
