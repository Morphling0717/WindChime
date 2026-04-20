import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'WindChime + SQLite 示例',
  description: '使用 SQL（SQLite）持久化风铃留言的 Next.js 示例',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hans" suppressHydrationWarning>
      <body className="px-4 py-10">{children}</body>
    </html>
  );
}
