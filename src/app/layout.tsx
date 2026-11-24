import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Newtion — 게임 개발팀을 위한 협업 워크스페이스",
  description: "문서, 데이터베이스, 실시간 공동 편집. 게임 개발 템플릿 내장.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
