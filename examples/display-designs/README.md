# 展示主题与排版样板

使用共享 `WindChimeLiveCard`，与桌面和独立展示窗口复用实际渲染代码。

- 排版：纵向信笺、图文双栏、横向条幅。
- 主题：纯净、UliUli 夜航、Mia 星祷。每个主题可以配任意排版。
- 支持切换宽高、滚动速度、横图/竖图、长信和九组合总览；所有内容均为合成示例，没有管理授权或信箱连接。
- 图片按可用列宽等比例放大。长信在固定视窗内滚动到底，停留后回到顶部循环；短信静止，仅循环当前内容，不切换来信。框架与装饰始终固定。
- 主题名只在私人样板控制项出现，观众展示卡片不带 UliUli 或 Mia 品牌文字。

安装根目录与 `apps/desktop` 的依赖后，在仓库根目录运行：

```powershell
node scripts/build-display-designs.mjs
node apps/desktop/node_modules/electron/cli.js scripts/display-designs-smoke.cjs
```

输出 `.work/display-designs/WindChime-Display-Designs.html` 可双击在浏览器离线打开，是单一自包含文件。样板不加载远程字体、图片或脚本，也不向网站发送请求。截图和实际渲染验证报告在同目录。
