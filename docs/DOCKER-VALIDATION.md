# 0.5.0 Docker 补测记录

日期：2026-09-09。本轮使用三个仓库当前工作文件的独立副本和合成 SQLite 数据，在 macOS 外接 APFS SSD 上实际构建并运行镜像。未连接生产数据库、部署服务器、公开发布 npm 或运行 GitHub Actions。

## 环境与构建

Colima 0.10.3、Lima 2.2.0、Docker CLI 29.4.0、Docker Engine 29.5.2、Buildx 0.37.0、Compose 5.5.1。虚拟机使用 4 核、8 GiB 内存、100 GiB 数据盘和 20 GiB 系统盘，磁盘按需增长。虚拟机为 ARM64，Rosetta 执行目标 AMD64 镜像；没有将虚拟机架构当作应用镜像架构。

所有构建明确传入 `--platform linux/amd64`，使用仓库自己的 Dockerfile。两站从各自仓库的 `vendor/` 安装固定包；示例从 WindChime 仓库构建。镜像检查及容器内 Node 均确认 Linux/x64：

| 镜像 | 构建 | 镜像 ID（SHA-256） | 容器 Node / SQLite |
| --- | --- | --- | --- |
| `windchime-test/uliuli:0.5.0` | 通过 | `c82c7b80342b9486ca2f753681d1b1cf4f5b3bd6250f419db709ba6e14db6691` | 20.20.2 / 3.52.0 |
| `windchime-test/mia:0.5.0` | 通过 | `bfc925ae6e193d1756fc486649034f80a3f53702d78f16a4fd2cc3b2c654c917` | 20.20.2 / 3.52.0 |
| `windchime-test/example:0.5.0` | 通过 | `9fbbf4bc4771bc27271433f03a960a07067c43eb9da60d49205f563ab95570fe` | 22.23.2 / 3.52.0 |

两站容器内安装的全部 138 个包文件分别与固定压缩包逐字节核对，均一致。包的 SHA-256 保持为：

```text
c21f59ae1ef149938c1e8bd5b070eee54bfa3f4b87d1c2f7c198b188ba817909
```

本轮没有重新生成同名压缩包。新增修复涉及宿主 CSV 接入、私有构建脚本及示例 Dockerfile，未改变库运行时源码、发布产物或依赖锁。示例 Docker 验证使用源码安装；此前的仓库外真实压缩包独立接入结果另见 [原验证记录](VALIDATION.md)，两者不混称。

## 运行、数据与权限

- UliUli、Mia 分别执行原有完整 HTTP 回归和 CLI 迁移脚本。新库、缺少话题字段的更早旧库、当前结构各迁移两次；原信件 ID、时间、状态、归档话题、屏蔽哈希、默认开关及宿主数据保留。额外构造不支持的旧结构，确认迁移失败明确报错且回滚原表和记录。
- 两站另用独立容器与数据卷验证旧结构直接由应用首次启动接管，再重启检查重复初始化；没有提前执行 CLI 来替代应用初始化。
- 示例 11 组 HTTP 回归通过：权限与原登录、设置与校验、活动时间窗、公开 DTO/SSR、投稿审核、已读收藏及批量范围、原子归档与恢复、屏蔽解封、永久删除、同源写入保护与退出登录。页面静态资源请求通过。
- 三个主容器均验证重启前后的会话、信件、已读、收藏、审核原文、内部备注、归档、设置和屏蔽身份。相同发送者重启后再次投稿仍匹配原屏蔽，返回成功但不保存。UliUli 还在修复 CSV 后重建容器，复用原卷完成再次验证。
- SQLite 原生模块实际加载，`PRAGMA integrity_check` 通过。示例实际 UID 为 1000，验证了非 root 用户对 `/data/windchime.db` 的写入权限。

示例的更早旧库和当前结构也完成非 root 应用首启升级与重启重复迁移。六份两站及示例迁移样本均在容器停止后导出，包含必要 WAL/SHM，离线只读完整性检查及 SHA-256 清单已保存。

另在独立 Linux/AMD64 容器中，将原 `backend.test.mjs` 对镜像内已安装的固定包执行，20/20 通过，覆盖八连接并发初始化、精确限流、时间窗、Turnstile 验证器及归档/屏蔽/永久删除事务故障回滚。这与宿主 Node 20/24 各 41 项完整测试分开记录。

## 浏览器

使用外接盘上的独立 Chrome 配置，验证桌面 1280 像素及手机 390 × 844。三者均完成真实登录、话题创建、默认和活动投稿、已读与收藏、12 次快速话题切换、二维码/海报 PNG 和 CSV 实际下载。已检查文件尺寸、内容及 CSV 单 BOM；公开页面未出现内部备注。两站外观、文案和导航保持原有设计。示例 `/ui` 在桌面和手机均正常加载，自定义页面不依赖该可选界面。

页面没有白屏或横向溢出，信箱业务页面无运行异常。保留两个非业务资源发现：Mia PWA `/app.jpg` 404，以及示例未提供 `/favicon.ico`，浏览器首次自动请求返回 404。它们不影响信箱操作和分享下载；没有把这两项记录为全静态资源零错误。全部独立浏览器会话已关闭。

## 发现并修复的问题

1. 两站各自为共享 CSV 再加了一次 UTF-8 BOM。改用已有公开接口 `downloadWindChimeCsv`，保留原文件名和选中信件规则。最终两站镜像的真实下载均只有一个 BOM，首列为 `id`，已读与收藏值正确。
2. 示例在 Docker 后续层再次构建时，旧 `dist` 目录的重命名触发 OverlayFS `EXDEV`。私有 `promote-build.mjs` 保留普通重命名路径，并在跨层时先完整备份再替换；失败恢复保留完整备份及明确位置。新增 6 项故障测试，库测试在 Node 20.20.2 和 24.14.1 各 41 项通过，无跳过；真实 Docker 构建也通过了原失败步骤。
3. 示例下载到的 SQLite 预编译模块要求 `GLIBC_2.38`，与 Debian Bookworm 不兼容。示例 Dockerfile 设置 `npm_config_build_from_source=true`，使用现有编译工具在同一 Debian 基础环境编译 SQLite。最终构建、启动和非 root 数据写入均通过。两个网站已有相同的源码编译策略。

测试副本第一次复制还误排除了 UliUli 的 `lib/namearena/data`，导致首次构建缺模块；复制规则已改为仅排除根数据库目录 `/data/` 并做文件校验。动态测试端口在容器重启后改变的问题也已在测试脚本中修正。这两项属于测试工具问题，不是网站业务缺陷。失败日志均保留；最终成功记录没有覆盖失败原因。

## 可重复执行

下列命令在各仓库根目录运行，构建上下文不需要相邻网站仓库：

```bash
# Next_UliUli
docker build --platform linux/amd64 -t windchime-test/uliuli:0.5.0 .
# Next_Mia
docker build --platform linux/amd64 -t windchime-test/mia:0.5.0 .
# WindChime
docker build --platform linux/amd64 -f examples/next-sqlite/Dockerfile \
  -t windchime-test/example:0.5.0 .
```

启用 Turnstile 时须增加 `--build-arg NEXT_PUBLIC_TURNSTILE_SITE_KEY=你的公钥`；secret 仅作为运行时环境变量。原 Compose 文件经配置解析检查，但本轮实际采用隔离的 `docker run`，没有启动生产反向代理。

例如在先准备好示例配置后，使用命名卷启动：

```bash
docker volume create windchime-example-data
docker run -d --name windchime-example --platform linux/amd64 \
  --env-file examples/next-sqlite/.env.local -e DATABASE_PATH=/data/windchime.db \
  -p 127.0.0.1:3010:3000 \
  --mount type=volume,source=windchime-example-data,target=/data \
  windchime-test/example:0.5.0
docker restart windchime-example
docker stop windchime-example
```

两站完整测试命令及登录配置在各自 `docs/windchime.md`。测试脚本需要显式启用本地写入，必须使用隔离测试数据库。生产使用 HTTPS 和自己的固定秘密，不要复用测试配置。

## 存储、证据和边界

本轮材料保存在 `/Volumes/2TB SSD/WindChime-validation`：`sources/` 为工作副本，`tools/` 和 `downloads/` 为工具，`runtime/` 包含虚拟机、镜像、缓存和命名卷，`qa/` 包含测试脚本及离线数据库样本，`browser/` 包含独立浏览器数据、截图和下载，`logs/`、`results/` 保存原始输出与 JSON 结果。目录内 README 提供重新启动、构建、测试及停止命令。

最终停止了全部 10 个测试容器、独立浏览器会话和 Colima `wc` 虚拟机，3010、3011、3012 均不再监听。保留镜像、卷与离线数据；最终主容器导出的 9 个数据库也全部通过只读完整性检查。停机时外接验证目录实际占用 **13.38 GiB**，该盘剩余约 1.5 TiB；不是预分配占满 100 GiB。Docker `system df` 的镜像与构建缓存存在共享层，不应直接相加当作物理占用。停机与占用证据为 `results/final-shutdown.json`、`results/storage-before-stop.json`。

关闭默认宿主目录挂载。工具、Lima 下载缓存、临时目录和浏览器配置均重定向到外接盘；系统盘仅新增 `/tmp/wc-runtime` 与 `~/Library/Caches/lima` 两个小型链接。macOS 自身的日志或交换空间不由这些工具设置控制，不宣称系统盘零写入。

- 这是本机 Rosetta 下的 Linux/AMD64 验证，不是服务器原生性能测试或生产数据验证。
- Mia 首页 PWA 请求 `/app.jpg` 返回 404；基线 `d457bf7` 的 manifest 已引用该文件，但仓库未跟踪 `public/app.jpg`。信箱页面、操作和下载通过；本轮未修复这一既有资源问题，也没有据此断言线上资源缺失。
- 此前 UliUli 开发模式首页手机端的 `SongSystem` 水合警告已在原基线复现；本轮 Docker 生产模式未复现，不能据此声称已经修复。 随后同日已在 UliUli 独立修复并完成开发浏览器及干净生产构建回归，见其 `docs/song-system-hydration.md`；本报告保留的较早 Docker 镜像不包含该后续修复。
- 未运行 GitHub Actions、真实 Cloudflare 挑战、生产 HTTPS 代理、npm 发布、线上部署或生产迁移。依赖安装提示现有锁文件的 audit 警告，本轮没有扩大到依赖安全审计或自动升级。
