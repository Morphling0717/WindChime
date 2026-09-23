# Next_UliUli：0.8.3 的 c4efb3d 精确包验证

共享源码：c4efb3dd2d7dab7fa432bc29350f0b3ed74b6a58。使用独立文件 vendor/windchime-embed-0.8.3-c4efb3dd2d7dab7fa432bc29350f0b3ed74b6a58.tgz；SHA256：a79abe42607b314f932f32618722528079842b59588e01cabf883936f8ae28f3，大小 54912376 字节。之前的 0.8.3 包及其证据均保留。

在 c0956f7f58ca40246dda5d7853120ed55e6ab917 的新隔离 Git 工作树中执行本轮验证，Node v20.20.2、npm 10.9.8、Windows x64。干净 npm ci、生产构建、fresh / legacy / current 三种数据库各两次迁移、完整邮件 HTTP 回归均通过，未复用旧包结果。迁移验证原信、状态、话题及授权范围、哈希、到期与派生撤销关系。

HTTP 验证包括批准不自动播放、手动上屏与隐藏、撤销和改稿撤下、展示握手空白、话题与只读授权隔离、队列移除和重排不绕回，以及原投稿、筛选、收藏、归档恢复、批量操作、屏蔽和设置。两站管理密钥、展示密钥及 Cookie 双向越权均拒绝；父密钥撤销使派生展示失效。

锁文件只更新风铃条目的路径和 integrity。首次 npm 尝试引入无关可选依赖变化，被检查拒绝；恢复原有条目后两站重新 npm ci 成功。vendor/SHA256SUMS 补齐了真实文件摘要，旧文件未覆盖。

原工作区和未提交的 tsconfig.json 未修改；Next 对隔离 tsconfig 的自动调整已经还原。临时服务只监听 <synthetic-loopback-origin>/3182，验证后均已退出。使用合成凭据与独立数据库，没有访问生产环境。

构建仍有 NFT 路径追踪及 Edge 静态生成警告，详见日志。此证据不代表图形浏览器、Windows 安装/卸载或 OBS/直播姬采集通过；SW 缓存排除仅在 VM 验证。本轮仅供开发分支草稿 PR 审阅，不代表已部署或合并 main。
