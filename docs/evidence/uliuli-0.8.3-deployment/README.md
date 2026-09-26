# UliUli 0.8.3 生产部署记录

2026-09-24 已将 [UliUli](https://uliuli.cn) 从共享库 0.8.1 升级至 **0.8.3**。生产源码为合并后的 `main` 提交 `0aa155fddcf21acf12a7f9f240315dce8cf24b3d`，镜像为 `sha256:021a637beda677dc2b3feece5903bde46b8742563488c90fe3d869bd071d5d99`。已安装包版本由运行中的容器直接读取确认；Mia 本轮没有部署。

## 实际结果

| 检查 | 结果 |
| --- | --- |
| 隔离构建 | 523.7 秒完成；构建期间原生产容器身份、运行时间不变。 |
| 空间保护 | 完整备份及构建上下文准备后，执行前仍要求至少 8192 MiB；每 2 秒监测，低于 1280 MiB 仅中止本次构建。实际最低剩余约 4.00 GiB，没有触发中止。 |
| 数据库副本升级 | 连续执行两次迁移，34 张原有表的全部原有字段内容保留，旧授权范围、哈希、有效期及设置保持原义。 |
| 登录后的管理与权限 | 286 次实际 HTTP 请求、388 项断言通过，测试使用生产数据副本和合成来信。 |
| 回退兼容 | 用旧 0.8.1 镜像启动升级后的副本，批准结果和新排版保留；首次展示为空白，新的手动上屏和隐藏通过。 |
| 正式切换 | 从停止旧容器至本机完整校验通过共 7.6 秒；再次备份停站时的最新数据后迁移，没有用旧数据库覆盖线上数据。 |
| 公网 | 首页、App Hub、信箱、健康检查及能力接口通过；未授权管理和展示请求均返回 401，旧 `/mail/live` 跳转 `/mail`。 |
| 资源 | 200 个公开资源在隔离站点、正式容器和公网逐一校验字节数与 SHA-256；非 GitHub 素材一并保留。 |
| 配置与工作区 | 正式 `.env` 字节、运行环境、三个持久挂载不变；本机两站未提交的 `tsconfig.json`、个人配置和概念图未改。 |

生产沿用原部署分支，将其快进至上述已合并提交；服务器本地 `main` 引用未擅自移动。固定使用的共享 TGZ 摘要为 `a79abe42607b314f932f32618722528079842b59588e01cabf883936f8ae28f3`，与正式发布文件一致。

## 验证范围

管理回归包括站点／话题／只读授权、密钥撤销及派生授权失效、话题和收件箱操作、批量操作、黑名单、CSV、违禁词开关、18 个主题／排版组合、审核待播、旧请求冲突、修改撤下、隐藏与重开空白。原有数据逐行核对，测试没有在生产站创建测试信或管理密钥。

本次公网读检查另从 Windows 电脑执行，确认首页、`/mail`、健康检查和六项新版能力可以从服务器外访问。图形界面、安装包和直播采集沿用 [0.8.3 成品 QC](../../RELEASE-083.md) 的独立证据，不把 HTTP 检查算作重新完成那些验收。

## 备份与清理

本轮私有备份保留升级前 Git bundle、精确环境与 Compose、全部数据目录、SQLite 一致性备份及非 GitHub 公开素材；停站后又保存最新整目录和数据库备份。旧运行镜像及先前回退镜像均保留。

此前空间整理只移除了已经导出到本机、完成压缩包与镜像对象校验的指定旧镜像标签和一个旧停止测试容器；未清理卷、数据库、资源目录或回退备份。本轮构建和切换没有执行广泛 prune。备份位置和原始检查报告仅保存在本地运维记录，不公开密码、数据库、来信或服务器私有路径。

## 命令与证据

以下为实际执行顺序，`<private-backup>` 代表本轮私有备份目录。辅助脚本经过离线保护测试并固定 SHA-256；这是审计记录，不是可任意复用到其他服务器的安装指令。

```text
node .work/v083-prepare-runner.cjs --execute
python3 <private-backup>/v083-build-monitor.py --backup <private-backup> --execute
python3 <private-backup>/v083-deploy.py clone --backup <private-backup> --execute
python3 <private-backup>/v083-clone-management.py --execute
python3 <private-backup>/v083-deploy.py rollback-check --backup <private-backup> --execute
python3 <private-backup>/v083-deploy.py review-proxy --backup <private-backup> --execute
python3 <private-backup>/v083-deploy.py cutover --backup <private-backup> --execute
python3 <private-backup>/v083-deploy.py public --backup <private-backup> --origin https://uliuli.cn --execute
```

[机器可读结果及私有报告摘要](result.json)。构建、隔离验收、正式切换和公网验证各自记录了成功结果。

## 保留的限制

此次部署没有新增或解决成品报告中未完成的两项：直播姬静默断线精确 3 秒时限、实际休眠后持续运行恢复。两项继续如实保留。生产基础仍为单持久 Node 进程和 SQLite；本次没有验收多副本部署，也不包含签名、自动更新或 B 站官方接入。
