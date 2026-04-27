import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 德州扑克训练平台",
  description: "面向行动前 AI 教练建议的无限注德州扑克训练平台"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
