# 风铃许可与桌面分发声明

风铃仓库与桌面应用使用 **MIT License**，根目录 [`LICENSE`](../LICENSE) 已包含 `Copyright (c) 2026 WindChime contributors` 及完整许可正文。本次保留这些现有署名，不替换成第三方作者或新的个人署名。共享库和桌面 `package.json` 的 SPDX 标识均为 `MIT`。

MIT 是开源许可证名称。它允许使用、修改和再分发，也允许商业使用；分发软件或其主要部分时应保留版权和许可声明。MIT 的原文还包括“不提供担保”的条款。以上说明以 [OSI 的 MIT 正文](https://opensource.org/license/mit) 为依据，软件包内的完整正文才是分发文件。

## 桌面程序包含什么

桌面 JavaScript 由 esbuild 合并。许可收集器读取本次实际构建的 `metafile`，根据输出中贡献了字节的输入找到已安装依赖，再读取它们的版本、许可文件与原有源码声明，不依据根 `node_modules` 列表猜测分发内容。

本轮实际桌面渲染器依赖如下。版本取自本地构建所用安装包，后续构建以生成的 `manifest.json` 为准。

| 组件 | 当前版本 | 包声明许可 | 保留的署名或附加声明 |
| --- | --- | --- | --- |
| React | 19.2.4 | MIT | Meta Platforms, Inc. and affiliates |
| React DOM | 19.2.4 | MIT | Meta Platforms, Inc. and affiliates |
| Scheduler | 0.27.0 | MIT | Meta Platforms, Inc. and affiliates |
| qrcode | 1.5.4 | MIT | Ryan Day 2012；源码另有 Ryan Day 2011、Kazuhiko Arase 2009 和 QR Code 商标声明，原样保留 |
| dijkstrajs | 1.0.3 | MIT | Wyatt Baldwin 2008；同时保留包内 `LICENSE.md` 和源码注释 |

`qrcode` 的 Node 专用 PNG/命令行依赖 `pngjs`、`yargs` 没有进入本轮浏览器构建。esbuild、Electron Forge 及其他构建工具不作为桌面运行时模块打入 `app.asar`。主进程使用 Electron、Node 内置模块和项目自己的本地代码。许可收集不是将所有构建依赖改成 MIT。

Electron 本身另有 MIT 许可及自己的作者署名。它携带的 Chromium 和其他运行库包含多种独立许可，并不统一采用 MIT；上游完整清单位于 `LICENSES.chromium.html`。安装器技术本身的许可也独立于风铃软件许可，不以风铃的 MIT 文本替换。

## 安装向导组件

安装器的玻璃向导界面为风铃自有 WPF/C# 代码，沿用项目 MIT；安装引擎采用 electron-builder 提供的 NSIS 3.0.4.1 与 `nsis-resources` 3.4.1。这些工具的内容由 builder 的固定摘要下载机制核对。`generateInstallerLicenses({ root })` 应在 `make` 的 Forge 打包之前调用，独立于不需要联网的日常桌面构建。它首次从上游下载原包和源码，后续复用摘要一致的文件；下载结果不一致则停止打包。

| 组件 | 保留的真实许可信息 | 分发内容 |
| --- | --- | --- |
| NSIS 核心和标准插件 | zlib/libpng；压缩模块另含 bzip2、CPL-1.0 及 LZMA 链接例外 | 原始 `COPYING` 完整正文 |
| electron-builder 安装脚本 | MIT，原文署名 Loopline Systems | 原始 `LICENSE` |
| StdUtils 1.14（DLL 1.1.4.0） | LGPL-2.1 或后续版本，另附作者对原样 NSIS 插件用法的澄清 | 原始 LGPL、澄清、ReadMe、原版 ZIP 和对应源码包 |
| nsis7z 19.00 | 原版说明保留 LGPL 描述；其 LZMA SDK `License.txt` 声明为公有领域，两份内容均保留 | 原版源码与二进制包、LZMA SDK 19.00 源码包、原始说明及许可 |
| UAC | zlib | 原始许可、History 和含源代码的原版 ZIP |
| WinShell | [插件官方页面](https://nsis.sourceforge.io/WinShell_plug-in) 标注 Freeware；原版 ZIP 没有单独许可正文或源代码 | 官方作者 Anders、来源和许可标注说明，以及原版 ZIP；没有将其改标为 MIT |
| nsProcess 1.6 | 原版提供作者说明和源代码，但未提供 SPDX 标识或单独许可正文 | 原始 Readme、源文件及完整原包；没有代替上游补写许可 |

StdUtils 作者的澄清允许原样 DLL 严格通过 NSIS 插件接口使用时，安装器采用自己的许可；DLL 自身仍保留其 LGPL 条款。风铃不修改这些上游 DLL，也不增加禁止为调试库修改而逆向分析的条件。对应源码随包提供，不仅给一个下载链接。nsis7z 按原文说明将 SDK 的 `C`、`CPP` 目录叠加到插件源码的 `Contrib/nsis7z`，再用 VS 2017 打开上游 solution。以上原版说明和归档以实际分发文件为准。

五个第三方插件的 x86 Unicode DLL 已分别与官方原包逐字节比对一致，包括原包中名为 `nsProcessW.dll` 的 Unicode 文件。`installer-manifest.json` 保存各 DLL 摘要、来源、原包摘要和全部通知文件摘要。未知或变化的 DLL 不直接沿用旧通知，生成脚本会要求重新核对。

`build/licenses/INSTALLER-NOTICES.txt` 汇总安装器通知；`installer/` 保留原文；`installer/sources/` 保存对应原包及源码。不将“项目使用 MIT”解释为所有第三方运行库均使用 MIT。未提供 SPDX 的上游组件以原始公开说明和分发文件如实记录，不伪造许可保证。

## 构建产物与保留要求

`apps/desktop/scripts/licenses.cjs` 导出 `generateDesktopLicenses({ root, metafiles })`。其中 `root` 是桌面应用绝对路径，`metafiles` 是连接密钥解析器、控制端和展示端等实际打包步骤返回的 esbuild 元数据。构建时对相关 `build()` 开启 `metafile: true` 并保存返回值，然后调用：

```js
import licenses from './licenses.cjs';
await licenses.generateDesktopLicenses({
  root,
  metafiles: [parserResult.metafile, rendererResult.metafile],
});
```

输出固定在 `apps/desktop/build/licenses/`：

- `WindChime-MIT.txt`：项目 MIT 原文，逐字节复制。
- `THIRD-PARTY-NOTICES.txt`：实际捆绑 JavaScript 依赖的许可正文、附加通知和相关源码声明。
- 各组件目录：上游 `LICENSE`、`COPYING`、`NOTICE` 等文件原样复制，以及 `SOURCE-NOTICES.txt`。
- `manifest.json`：版本、许可标识、实际输入文件和声明文件的 SHA-256。没有本机绝对路径或任何凭据。

收集器遇到缺失许可文件时让构建失败，不能默认补写 MIT。它不会覆盖 Electron 分发根目录的许可文件。安装版和便携版都必须保留 `WindChime.exe` 同级的 Electron `LICENSE` 与 `LICENSES.chromium.html`，以及应用资源中的 `build/licenses` 内容。若安装器额外提供便于用户打开的声明目录，应复制这些文件，不更改其正文。

每次改动捆绑入口或新增依赖，应检查新 `manifest.json`、源码内的附加通知及安装包中的实际声明。上游原文件若只提供链接或较短声明，也原样保留，不伪造作者正文。Electron 的运行库清单不能用仅包含上表的 JavaScript 汇总文件替代。

## 验证

在 `apps/desktop` 执行 `node --test tests/license-distribution.test.cjs`。测试实际构建当前渲染器，确认 QR Code 的历史作者和商标说明未丢失、开发工具未错误列入运行时、未知许可未被改标为 MIT；同时检查文件内容和摘要、重复生成、缺少声明时阻断、原 Electron 许可文件不被覆盖，以及源码缓存损坏或下载摘要变化时拒绝使用。
