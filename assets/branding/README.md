# 风铃品牌资产

当前使用用户于 2026-09-13 确认的 [windchime_logo](./windchime_logo/) 整套文件。原始来源为用户下载目录中的同名文件夹；复制入仓库的 82 个文件、9,627,889 字节已逐一核对 SHA256，内容保持一致。索引、品牌说明、各场景版本和参考原稿一并保留。

桌面 0.6.3 按场景使用文件，而非把同一张复杂大图用于全部尺寸：

| 场景 | 文件（相对 windchime_logo） | 构建输出 |
| --- | --- | --- |
| 应用图标 48/64/128/256 px | `05_App_Icons/WindChime_app_dark_1024.png` | ICO 对应尺寸、`build/icon.png` |
| 16/24/32 px 图标及托盘 | `04_Monochrome/WindChime_symbol_small_white.svg` | 等比缩放后置于品牌深蓝 `#263A58` 底板；`build/tray.png` 为 32 px |
| 宽窗口侧栏 | `02_Lockups/WindChime_header_navy.svg` | 原样复制为 `build/brand-header.svg` |
| 窄窗口侧栏 | `04_Monochrome/WindChime_symbol_small_navy.svg` | 原样复制为 `build/brand-symbol.svg` |
| 安装动画 | `02_Lockups/WindChime_horizontal_glass_light.png` | 保留完整琉璃主图、中英字标和比例，嵌入安装画面 |

正式资产未重绘、变色或覆盖；缩放和小尺寸底板只存在于构建产物。显示用 SVG 为自包含路径，没有脚本、外链或字体依赖。琉璃主图为原稿分离的位图，单色 SVG 为同源简化路径，不宣称具备原生 3D 工程。其他网站可继续按包内索引选择 favicon、横版标志、字标及社交素材，本轮未修改宿主网站。

`windchime-logo-v1-*` 是早期已停用的历史文件；本地 `concepts/` 为被否决的候选，不进入默认构建或发行包。

## 历史初稿记录

以下为早期平台登记阶段的原始记录，不代表当前品牌或桌面接入方式。

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
