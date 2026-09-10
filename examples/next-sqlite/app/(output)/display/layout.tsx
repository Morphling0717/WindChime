export default function DisplayLayout({children}:{children:React.ReactNode}) {
  return <html lang="zh-CN" style={{background:"transparent"}}><head><meta name="referrer" content="no-referrer" /></head>
    <body style={{background:"transparent",margin:0,overflow:"hidden"}}>{children}</body></html>;
}
