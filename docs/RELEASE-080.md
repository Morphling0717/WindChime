# 风铃 0.8.0

发布日期：2026-09-20。共享库与 Windows 桌面统一为 0.8.0；分发共享库压缩包、Windows x64 安装包和便携 ZIP，不发布 npm registry，不合并各仓库 main。

## 使用变化

- 六种排版可独立搭配纯净、夜航、星祷三个主题；观众画面不显示 UliUli/Mia 字样。
- 字号、画面尺寸、图片占比和文字滚动可调整。图片始终在下方完整等比显示，只有文字区域滚动。
- 直播工作台五类模块可变成置顶私人磁贴；设置可录制“下一封”全局热键，保留紧急隐藏按钮、托盘和快捷键。
- 审核与上屏独立。新窗口、断线重连和重启保持空白，需新的手动上屏。

操作见 [展示设计](DISPLAY-DESIGNS.md)、[磁贴与快捷键](FLOATING-TILES.md) 和 [桌面 README](../apps/desktop/README.md)。

## 网站升级

两站固定使用同一个 `windchime-embed-0.8.0.tgz`。现有信件、话题、授权范围、有效期、词过滤设置和持久目录必须原样保留；0.8.0 不新增数据库表，扩展现有外观 JSON。旧站点仍可连接，但新外观保存需要服务端升级。

升级前备份数据库、媒体及未纳入 Git 的资源，在副本重复迁移并验证。旧 0.7.0 不能读取新增外观字段，回退必须停写、备份当时数据并只转换外观，或使用经过验证的兼容镜像；不要用升级前整库覆盖新投稿。

UliUli 沿既有开发分支备份、隔离构建并部署；Mia 只更新代码和本地验证。本次不改变 B 站项目或私有密钥，桌面不依赖网关。

## 验证范围

本次重新执行：共享库 179/179 测试、共享 tarball 隔离安装、桌面 61/61 测试、桌面构建及打包、两站生产构建和信箱 HTTP 回归、新/旧/当前数据库各两次迁移，全部通过。包结构、Setup 内嵌 Logo 动画及哈希通过；新便携 ZIP 内 EXE 在独立空配置下成功启动，只有私人窗口，托盘关闭/恢复和优雅退出正常。

证据见 [桌面发行报告](evidence/0.8.0/desktop-release-summary.json)、[共享库测试](evidence/0.8.0/shared-tests.txt)、[tarball 安装验证](evidence/0.8.0/shared-pack-check.txt)，以及两站各自的 `docs/WINDCHIME-080-UPGRADE.md`。两站保留既有 NFT 路径追踪警告，未影响生产构建或 HTTP 验证。

共享包 SHA-256：`d754cb191a07107ffa81a0b50ae6322b690481f3f720f1f131844a5f5da2d3e3`。Windows 发行目录为 `apps/desktop/out/releases/0.8.0`；[Windows 校验和](evidence/0.8.0/desktop-SHA256SUMS.txt)。旧 0.7.1 同名产物已复制保存在相邻版本目录。

功能阶段的实际验证见 [竖向排版验收](DISPLAY-VERTICAL-VALIDATION.md)、[磁贴验收](DESKTOP-TILES-VALIDATION.md)。本版尚不能据此声称完成 OBS/直播姬实际窗口捕获、系统级热键按键注入或安装/卸载复验。此前安装清理被自动审批拒绝，本次不执行安装器或绕过该拒绝；便携启动与安装验收分开记录。

## UliUli 生产更新与验收

**UliUli 0.8.0 已完成正式切换，本机与公网检查通过。**代理实际打开文件描述符的门禁通过，停站后相关文件描述符为 0，再完成最终一致备份和迁移。Mia 仍仅更新代码与本地验证，两个网站均不合并 main。

线上代码为 `b858739f42a53daea7313a7b4b4dc4393b179479`，当前镜像为 `sha256:4fd822740c7b96de23996f4fe0f0c1da342d5b1a474ab114fe92f14a9ce04150`。切换前代码 `fc16de50011227cd69fba064b541a38f85cf76d9` 及原 0.7.0／再前一回退镜像仍保留。原环境、Compose、data 和 200 个 public 文件备份于服务器私有目录 `/root/windchime-deploy-backups/uliuli-080-20260919T180554Z`；停写后的最终备份为 `codes.final.sqlite` 和 `data-final`。私有数据和配置不作为发行内容提交。

| 服务器上的隔离验证 | 结果 |
| --- | --- |
| 一致备份副本迁移两次 | 34 个既有表的原列内容保留，授权范围及敏感词设置不变 |
| 新镜像真实管理与播出 API | **307 项断言、224 次 HTTP 请求通过**；六排版／三主题、审核与上屏分离、队列与隐藏、撤销和改稿重审、权限隔离及原信箱业务通过 |
| 页面、权限和资源 | health、主站、App Hub、mail、capabilities 正常；未授权管理与展示为 401，旧 live 为 307；200 个原资源核对通过 |
| 实际 0.7.0 镜像回退 | 新外观经导出与事务转换后，**36 次 HTTP 请求、六种排版验证通过**；初始输出空白，批准保留，其余数据不变 |

正式切换再次核对 **34 个既有表的全部原列、环境、持久挂载和 main 均不变**，200 个原资源保持一致。从停止旧站写入到完整本机验收结束为 **6.34 秒**，不是精确的公网网络中断时长。公网 health、capabilities、主站、App Hub、mail 均正常，未授权管理与展示仍为 401，旧 live 为 307，200 个 public 资源逐字节检查通过。

回退只转换旧版不能读取的外观字段和清屏状态，不覆盖整库，不丢弃新增信件、授权或队列；正式执行前必须备份停写时的最新数据及完整外观。两个最旧且未使用的 2026-07-14 镜像先完整归档本机、逐层验证后才从服务器卸载，当前与前一回退镜像保留。归档位于本仓库 `.work/server-image-archives/20260919T182455Z-v8gPoY/`，每份验证 14 层；两份 tar SHA-256 分别为 `ef9e54badebcf288a32724845e32402ea5ca7c416685a2ad0d74e0af59181b63` 和 `1f7000d4bf774b3936ebd80e58274e1155542038b30f1f37710ddb34ca9f7a7e`。

公开证据集中保存在 UliUli 仓库：[正式切换及本机验收](https://github.com/Morphling0717/Next_UliUli/blob/codex/windchime-desktop-v0.6.0/docs/evidence/windchime-0.8.0/production/cutover-result.json)、[公网验证](https://github.com/Morphling0717/Next_UliUli/blob/codex/windchime-desktop-v0.6.0/docs/evidence/windchime-0.8.0/production/public-result.json)、[写入进程门禁](https://github.com/Morphling0717/Next_UliUli/blob/codex/windchime-desktop-v0.6.0/docs/evidence/windchime-0.8.0/production/writer-preflight-result.json)、[全部 8 份结果](https://github.com/Morphling0717/Next_UliUli/tree/codex/windchime-desktop-v0.6.0/docs/evidence/windchime-0.8.0/production)。公开副本标明 `redactedFields`，省略原业务计数及合成资源标识，未删减原始证据继续保留本机。安装／卸载与 OBS／直播姬窗口捕获未因此完成复验。详细记录见 [UliUli 0.8.0 生产更新记录](https://github.com/Morphling0717/Next_UliUli/blob/codex/windchime-desktop-v0.6.0/docs/WINDCHIME-PRODUCTION-080.md)。
