import Link from "next/link";
import "./globals.css";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <header>
          <strong>匿名信箱 · 自定义界面示例</strong>
          <nav>
            <Link href="/">投稿</Link>
            <Link href="/admin">管理</Link>
            <Link href="/ui">可选组件</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
