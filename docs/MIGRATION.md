# 从旧风铃和两个网站升级

0.5.0 接管已有 mail_* 表，不要求移动数据库，不清空网站其他表。两站继续拥有自己的登录、数据库路径和页面。升级前先在副本演练，然后使用各站已有 `npm run db:backup`（VACUUM INTO 与完整性检查）制作备份。这里记录的是迁移步骤；本次没有执行生产数据库迁移。

两站的备份/迁移 CLI 不自动加载 Next.js 的 `.env.local`。执行时显式传入实际绝对路径，先核对它是不是预期数据库；否则脚本会使用自身默认的 `data/codes.db`：

```bash
# 以下路径只是示意；备份源库和迁移演练副本须分别指定
DATABASE_PATH=/实际路径/site.db npm run db:backup
DATABASE_PATH=/演练副本/site.db npm run db:migrate
```

## 执行顺序

1. 停止旧应用写入，备份整个 SQLite 数据库；WAL 使用中不要只复制主 `.db` 文件。
2. 安装同一个版本包并提交 lock；在数据库副本执行网站 `npm run db:migrate`。
3. 检查 `PRAGMA integrity_check`，对比信件/话题/屏蔽数量、ID、slug、关联及各状态字段。
4. 启动新版，验证登录、投稿、审核、话题管理与屏蔽；再按自己的部署流程升级实际环境。
5. 如需回滚，停止写入，恢复备份及旧应用版本。不要假设旧代码能理解新版本产生的所有操作；不要让新旧进程同时执行迁移。

库会探测缺失列，先补列再建索引；早期没有 topic_id 的信件补入 default，不重写已有话题关联。默认话题 id/slug 保持 default，在默认话题尚不存在时从 mail_settings 的 mail.enabled 继承开关。已存在的默认话题开关和标题保留。迁移记录使用 windchime_migrations，不修改宿主 schema_migrations 历史。记录存在时不会重置默认话题或重复导入限流记录。库自己的 schema 迁移在事务中完成，失败会回滚并阻止业务继续；宿主历史迁移保持宿主原有的执行方式，不属于同一个跨连接事务。若旧库存在冲突的默认话题 ID/slug 或重复唯一键，初始化会报错，需先在副本核查，不能靠重置数据库绕过。

必须保留正文、昵称、链接、信件和话题 ID、topic_id、slug、全部时间、read/favorite/flagged/deleted 状态、内部备注、敏感词、黑名单。解除屏蔽仍不会恢复已软删历史。永久删除只作用于管理员明确选择的已归档非默认话题。

## 两站接入

两站的 lib/windchime-storage 只依赖数据库路径和 SQLite 适配器，初始化不调用宿主权限；lib/db 的 dbReady 先等待风铃 schemaReady，再运行宿主历史 SQL。完整 lib/windchime 服务再等待宿主 dbReady，避免初始化循环。

风铃与网站各持有自己的持久连接，指向原数据库文件，使用短事务和 busy timeout。事务内部不等待网络、鉴权或另一个连接的写操作。所有信箱规则都在包内；路由只挂载处理器，SSR/首页聚合用公开话题方法，浏览器通过 client/Hooks。

UliUli 保留 uliuli_mail_session 与原 admin_sessions。Mia 保留 mia_mail_session 和自己的签名验证，不把 admin cookie 自动提升为 mail 权限。旧密码 header/body 接入及登录锁定留宿主，其他登录流程不会随迁移删除。

**不得自动轮换既有盐值。** UliUli 未定义 WINDCHIME_HASH_SALT 时继续用旧的 uliuli-mail-default-salt；Mia 对应 mia-mail-default-salt。若旧配置显式设置为空字符串，也保留该既有行为，不自动用新盐替换。现有哈希的 IP 头次序、UA、换行拼接和 windchime:fp 存储键保持不变。新项目使用随机稳定盐，旧项目换盐属于额外身份迁移，不是本次操作。

## 兼容行为与修复

旧根 UI、CSS 导入、接口地址及主要输入仍保留。新代码优先使用明确子入口。

- 公开话题不再返回内部 note 和管理统计，SSR 同样使用 public DTO。
- 投稿返回最小成功结果，停止返回正文、senderHash 和管理属性；已屏蔽投稿也返回相同成功形式。
- all/unread/favorited 的列表和计数都排除待审核；flagged 有独立计数。
- 跨话题或不存在对象不再返回虚假成功；非法布尔输入不再强制转换为 true。
- 归档前标已读按目标话题在服务端原子执行，排除待审核；不依赖页面当前加载的信件。
- 请求失败保留草稿，切换话题不接纳旧响应；退出管理状态或关闭审核原文后不展示旧数据。
- 使用客户端公开方法 `listPublic/getPublic`，或 Hooks 的 `{mode:'public'}`；管理 `listAdmin/getAdmin` 和默认管理 Hooks 强制授权。旧 `topics.list/get` 仍根据静默鉴权自动选择视图。
- 调整旧前端对 Promise 的用法：`submit()` 返回成功布尔值，`openDetail()` 返回 void，管理 mutation 失败会抛出异常，读取失败通过资源 error 显示。

这些修复应通过升级同一个风铃包传递给两站。现有代码只定义过的回复字段不代表回复系统，本次没有新增回复业务。
