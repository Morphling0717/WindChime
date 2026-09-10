# 风铃 Logo 初稿

为 B 站 H5 插件项目登记生成，尚未替换网站或桌面应用的现有资源。

- `windchime-logo-v1-master.png`：内置 image_gen 工具生成的原始图片。
- `windchime-logo-v1-200.png`：平台上传版，200×200 PNG，小于 1 MiB；使用 Sharp 等比缩放导出。
- 视觉方向：薄荷青风铃与信封组合，呼应匿名来信与现有控制台配色。

项目名称建议：风铃。项目分类：H5 插件。

简介（含标点共 40 字）：

> 匿名来信，主播私下审阅，批准后手动上屏，支持图片、待播排序与一键隐藏，安心读信。

## 生成提示词

生成方式：内置 image_gen，未使用 CLI 或独立 API 密钥。

```text
Use case: logo-brand. Asset type: square app icon for 风铃 (WindChime), an anonymous fan-letter review and livestream display tool. Create one original polished logo, not a sheet of variants. Subject: a simple hanging wind chime whose suspended paper pendant is a small folded envelope, combining a recognizable broad rounded wind-chime cap, a short hanging string, and the envelope. Style: crisp flat vector-like raster logo, bold smooth geometric silhouette with rounded corners, calm, friendly, understated. Palette: mint teal #8fe1d5 and soft white on a solid deep ink navy #111a24 square background, matching the existing WindChime private console. Composition: centered large single mark, visually balanced, generous 15% safe margins, identifiable when reduced to a 200×200 platform icon and even 32×32. Envelope fold should be a simple clear V-shaped line. Keep few shapes, generous separation and thick lines. No lettering, no wordmark, no watermark, no mockup, no border, no gradients, no shadows, no texture, no tiny decorations, no existing platform trademarks. Produce a square PNG master suitable for export to 200×200.
```
