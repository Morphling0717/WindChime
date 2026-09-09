# Next.js + SQLite 完整示例

从仓库根目录执行 `npm ci`，然后：

```bash
cd examples/next-sqlite
npm ci --install-links
npm run setup
npm run db:init
npm run dev
```

投稿地址 http://localhost:3010，管理地址 http://localhost:3010/admin。setup 只在第一次创建 .env.local，并打印随机管理员密码；再执行不会覆盖已有身份盐和密码。需要时在生成的 `.env.local` 中同时添加 `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET`，更改公开 site key 后重新构建。全部页面 JSX 和 CSS 都在这个示例内；业务使用风铃公开接口，无 Tailwind 依赖。默认 UI 仅在 /ui 演示。

生产验证：`npm run typecheck && npm run build && npm start`。`npm start` 将静态资源和可选的 `public` 目录复制到构建产物，读取示例根目录的 `.env.local`，启动 `.next/standalone/server.js`，退出时同时停止子服务。已设置的环境变量优先于 `.env.local`；相对 `DATABASE_PATH` 以示例根目录为基准，避免启动后误用另一个数据库。默认端口为 3010，可用 `PORT=3013 npm start` 更改，`HOSTNAME` 可设置监听地址。生产登录需要 HTTPS（Secure cookie）。不要把此示例作为无密码开放的管理端。

`.npmrc` 的 install-links=true 让 file:../.. 安装为普通包副本，避免链接引入重复 React。风铃改变后重跑 npm ci --install-links，或在根目录运行 `npm run dev:sync -- --targets ./examples/next-sqlite`。`dev:sync` 不重启此例的开发服务器，必要时手动重启。版本发布测试仍必须执行根目录 npm run pack:check。

此例默认从同级风铃源码安装包副本。要演练发布文件，在示例目录执行 `npm install /绝对路径/windchime-embed-0.5.0.tgz`，再执行 setup、db:init 和构建；这是有意修改本例的 package.json/lock 来固定演练包，完成后恢复示例原本的 `file:../..` 依赖即可。新网站从压缩包安装时仍要显式安装 sqlite3，需要分享功能时再安装 qrcode。

**已实际验证 Linux/AMD64 镜像构建、SQLite 初始化、非 root 写入及容器重启持久化。** 从仓库根目录执行 `docker build --platform linux/amd64 -f examples/next-sqlite/Dockerfile -t windchime-example .`，或 `docker compose --env-file examples/next-sqlite/.env.local -f examples/next-sqlite/docker-compose.yaml up --build`。后者显式将 `.env.local` 用于构建参数插值，确保启用 Turnstile 时 site key 进入前端包。先运行本例 setup 生成配置；部署时使用自己的秘密和持久 volume。本轮在 Chrome 的本机回环地址验证了登录；生产管理员登录仍须经过 HTTPS 反向代理，不能将回环测试当作生产 HTTPS 配置验证。生产数据库在 /data/windchime.db。Turnstile site key 是构建参数，secret 仅在运行时配置。

Dockerfile 在 Debian 内从源码编译 sqlite3，避免下载的预编译二进制要求比镜像更新的 glibc。直接在 Linux 安装时，如遇 `GLIBC_* not found`，安装 Python 3、make、g++ 等构建工具后，用 `npm_config_build_from_source=true npm ci --install-links` 重新安装。使用 `docker run --env-file` 时另加 `-e DATABASE_PATH=/data/windchime.db`，覆盖 setup 生成的本地相对路径；Compose 已显式配置该路径。完整命令与验收边界见 [Docker 验证记录](../../docs/DOCKER-VALIDATION.md)。

本例的 `/admin` 已覆盖投稿管理、已读/收藏、批量、审核原文/放行、词库、屏蔽/解封、默认开关、话题创建/编辑/归档/恢复/永久删除、CSV、二维码及海报。登录和确认弹窗属于本例，业务来自公共 client/Hooks。

安装、已有登录接入、完整 API、升级和回滚均见仓库根 README 与 docs。本例 auth.ts 属于宿主登录代码，已有网站直接替换该层；不要复制信箱业务。
