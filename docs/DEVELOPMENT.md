# 本地联调、打包和发布

三个仓库继续独立管理，推荐同级摆放 WindChime、Next_UliUli、Next_Mia。先在各仓库运行 npm ci。联调脚本使用 POSIX 进程组管理自己启动的服务，当前面向 macOS/Linux；Windows 开发请在 WSL 中运行。

```bash
# WindChime 目录
npm run dev:consumers -- --uliuli ../Next_UliUli --mia ../Next_Mia
```

脚本先完整构建，成功后同步 package.json 和 dist 至两站 node_modules/@windchime/embed，启动 UliUli 3011、Mia 3012。后续源码保存触发完整构建和同步，再重启该脚本自己启动的开发服务，确保服务端和客户端都使用新产物。只同步、不启动服务：

```bash
npm run dev:sync -- --targets ../Next_UliUli ../Next_Mia
```

同步不写网站 package.json/lock、不复制风铃 node_modules，不使用跨仓 symlink。脚本检查包名、目标目录和依赖；遇到缺失的必需依赖或已安装但版本不兼容的依赖，会停止该轮并给出安装命令。sqlite3/qrcode 是可选 peer，未安装不会被联调脚本自动补上；网站启用相应能力时须先安装。临时同步只替换运行所需的 package.json 和 dist，删除的输出也会被移除；保留安装目录中的嵌套依赖和其他文件，不将这次同步当作完整发布包。编译失败保留前一份可用安装；同步失败不会声称两站全部更新成功。

两个 Next 配置保留自己的 Turbopack root，使用 transpilePackages。不要同时执行 npm ci 和同步；恢复锁定版本：先 Ctrl+C 停止联调，再在两站分别 npm ci，重新启动网站。联调数据库请指向隔离样本；脚本本身不替网站选择数据库。为两个网站分别在它们自己的环境配置中设置 DATABASE_PATH，避免把同一个导出的 DATABASE_PATH 传给两个进程。`dev:sync` 只同步，不替你重启手动启动的 Next 服务；出现服务器缓存时自行重启。

## 发布前检查

```bash
npm ci
npm test
npm run pack:check
```

pack:check 在仓库外临时目录安装真实 .tgz，验证 headless 入口运行时导入、包含可选 UI 的 TypeScript 使用、独立 SQLite 初始化和包内容；测试结束自动清除临时安装目录，结果和失败原因输出在终端。不能只用联调产物作为发布证据。

版本采用 SemVer。0.x 阶段可能影响调用方的语义变更写入 minor 的升级说明；patch 修复仍须保持公开契约。不要重新发布或覆盖相同版本号的不同内容。保持 package.json 与 lock 的版本一致，更新 CHANGELOG 和迁移说明，保留旧导入兼容入口直到另行发布删除计划。

## 0.5.0 本次交付

本次仅准备发布，不实际 npm publish、创建公开 Release 或部署网站。代码和检查最终冻结后执行一次 npm pack；记录 SHA-256，两站 vendor 使用同一字节包并锁定安装。网站 Dockerfile 继续复制 vendor，支持没有相邻源码仓库的安装；两站与示例的 Linux/AMD64 镜像均已实际构建运行，详见 [Docker 验证记录](DOCKER-VALIDATION.md)。容器内两站全部 138 个包文件与固定压缩包一致。本次 Docker 补测修复私有构建脚本、示例 Dockerfile 和网站 CSV 接入，没有改变库运行时代码或重新生成冻结包。

如测试后需要更改代码，先修复再生成最终包，尚未冻结的候选包不作为发布文件。正式发布后不得覆盖同名包；有修改就升新版本。

## 未来实际 npm 发布

维护者确认 @windchime scope 权限和 npm 登录后，检查 tag 对应 commit、CI、CHANGELOG 和真实包内容，再执行 `npm publish --access public`。仅在确认发布成功后创建对应 Git tag/Release。发布内容必须与经过验证的源码和版本对应。

两站发布后升级：`npm install --save-exact @windchime/embed@0.5.0`，提交 package.json/lock，按迁移文档升级数据库，再运行网站 test:mail:migrations、test:mail、类型检查和生产构建。新的共同修复来自风铃包，不重新复制业务源码。
