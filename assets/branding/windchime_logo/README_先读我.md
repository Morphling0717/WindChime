# 风铃 WindChime — 独立资产交付

英文名称固定为 **WindChime**，W、C 大写。

## 先找哪一个

- 网站横版标志：`02_Lockups/WindChime_horizontal_glass_light.png`。深背景使用 `dark` 版，二者均为透明底。
- 独立琉璃图形：`01_Glass/WindChime_symbol_glass.png`；网页可用同名 WebP。
- 网站导航：`02_Lockups/WindChime_header_navy.svg` 或 white 版。
- 单色印刷：`04_Monochrome/WindChime_symbol_mono_black.svg` 或同名矢量 PDF。
- 应用图标：`05_App_Icons`；头像与分享图在 `07_Social`。
- 所有文件：解压后用浏览器打开 `File_Index.html`，可预览并逐个打开文件。

## 文件边界

1. 琉璃 PNG / WebP 由选定原稿分离，主图形 617 × 1081 px。外部背景透明，玻璃内部的高光与折射观感来自原稿，不会对新背景自动重新折射。
2. 单色 SVG / PDF 是同源简化图形的描摹路径版，字标 SVG 是原稿轮廓描摹。不含嵌入位图；它们不是琉璃渲染的原生矢量或 3D 工程。
3. 没有原生 AI、分层 PSD 或 3D 源工程；不以更换后缀或放大位图冒充源文件。大型印刷或高要求雕刻前，建议在实际尺寸下复核节点、细线和镂空。
4. 彩色素材为屏幕用色；印刷需按输出条件与纸张打样。本包不提供未经打样确认的 Pantone / CMYK 对色承诺。
5. 不附字体文件。品牌字标可直接使用；没有替用户添加宣传口号。
6. 白色 PNG / SVG 在白底查看器里可能不可见，请放到深色背景；对应 PDF 为白色路径，不是空白文件。

## 网站图标示例

将 `06_Web_Favicons` 中所需文件放到 `public/brand/`；manifest 内采用 `/brand/` 路径。非域名根目录部署时修改路径。

```html
<link rel="icon" href="/brand/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/brand/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/brand/apple-touch-icon.png">
<link rel="manifest" href="/brand/site.webmanifest">
```

`site.webmanifest` 是配置示例，不是已经修改了你的项目仓库。未连接或更改你的代码。

## 索引

`assets.json` 是逐文件的格式、用途与尺寸记录。`File_Manifest.csv` 是便于检索的同一份清单。文件夹中的每个版本均为独立文件；压缩包只是汇总容器。
