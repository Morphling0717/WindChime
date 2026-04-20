# WindChime + SQLite（SQL）示例

本目录是一个独立的 Next.js 应用，演示如何把 `@windchime/embed` 的投稿与管理 UI 接到 **SQLite**（单文件 SQL 数据库）。

## 做了什么

- `lib/db.ts`：打开 `data/windchime.db`，执行 `CREATE TABLE` / 索引。
- `app/api/messages/route.ts`：`GET` 列表、`POST` 新增（参数校验与 `WindChimeMessageRecord` 字段一致）。
- `app/api/messages/[id]/route.ts`：`DELETE` 单条。
- `app/page.tsx`：`WindChimeSender` 的 `onSubmit` 调 `POST`，`WindChimeAdminPanel` 调 `GET` / `DELETE`。

## 运行

在仓库根目录先保证 WindChime 包已构建出 `dist/`（安装本示例依赖时会执行上游 `prepare` 脚本，一般会自动 `npm run build`）。

```bash
cd WindChime/examples/next-sqlite
npm install
npm run dev
```

浏览器打开 <http://localhost:3010>。数据库文件会出现在本目录下的 `data/windchime.db`。

## 说明

- `better-sqlite3` 为**原生模块**，需本机可编译（macOS 通常开箱即用；Windows 需 VS Build Tools）。部署到 **Vercel Serverless / Edge** 时不能直接用该驱动，应改用托管数据库或 Edge 兼容方案。
- 本示例**无登录、无 Turnstile 校验、无限流**；上线前请在服务端补齐。

## 1Panel + Docker（Next.js 常驻容器）

你的目标形态是：**宿主项目为 Next.js，WindChime 作为依赖嵌入，跑在 1Panel 的 Docker 里**。这与本示例完全兼容，注意以下几点即可。

1. **在 Linux 镜像里完成 `next build`**  
   `better-sqlite3` 的 `.node` 与平台绑定。不要在 macOS 上构建再拷进 Linux 容器；应像本目录 `Dockerfile` 一样在容器内 `npm ci && npm run build`。

2. **SQLite 文件要挂卷**  
   镜像默认 `WINDCHIME_DATA_DIR=/data`，库文件为 `/data/windchime.db`。在 1Panel 里给容器挂载「主机目录 → 容器 `/data`」，避免删容器丢数据。若改路径，设置环境变量 `WINDCHIME_DATA_DIR` 即可。

3. **构建上下文**  
   本仓库的 `@windchime/embed` 使用 `file:../..`，因此 **Docker 构建上下文必须是 WindChime 根目录**（与根 `package.json` 同级），命令为：

   ```bash
   cd WindChime
   docker build -f examples/next-sqlite/Dockerfile -t windchime-next-sqlite .
   ```

4. **你自己的 Next 项目**  
   把 `WindChime` 作为子目录或私有 npm 包引用均可；Dockerfile 中先 `npm run build` 生成 `dist/`，再构建主应用。Tailwind 仍需扫描 `WindChime/dist/**/*.js`（或等价路径），与本地开发一致。

5. **1Panel 网络**  
   容器内监听 `0.0.0.0:3000`（本镜像已通过 `HOSTNAME` 配置）。在 1Panel 站点/反代中把域名指到该容器端口即可。

### docker compose（可选）

```yaml
services:
  web:
    build:
      context: ../..
      dockerfile: examples/next-sqlite/Dockerfile
    ports:
      - "3010:3000"
    volumes:
      - windchime-sqlite:/data
    environment:
      WINDCHIME_DATA_DIR: /data

volumes:
  windchime-sqlite:
```

在仓库根 `WindChime` 下执行时，将 `context` 设为当前目录 `.`，`dockerfile` 设为 `examples/next-sqlite/Dockerfile`。
