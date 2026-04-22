/**
 * Mail Topics（多主题收件箱）的类型定义。
 *
 * 设计意图：
 * - `Topic` 类型尽量贴合 Dreamail / Marshmallow 的"收件组"模型：每个 Topic
 *   独立开关 + 时间窗 + 归档；常规收件箱 `isDefault=true`，不可归档。
 * - `state` 是派生字段（由服务器根据 `is_default / is_enabled / starts_at /
 *   ends_at / archived_at` 组合出来），前端拿到就能直接染色 / 分组，不再
 *   自己算时间窗。
 *
 * 这里**只定义类型**，不包含数据库 / API 实现——宿主应用自行在自己的
 * 后端（Next.js Route / Fastify / FastAPI 皆可）落实 CRUD。
 */

/**
 * 主题的 5 种运行状态。
 *
 * - `default`  常规收件箱（全库唯一，不可归档、不可删除）
 * - `active`   时间窗内且开关开启，正常接收投稿
 * - `scheduled` 未到开始时间，访客看到"活动即将开始 + 倒计时"
 * - `ended`    时间窗已过，访客看到"活动已结束"，主 tab 栏带"待归档"提示
 * - `archived` 主播手动归档（软删），不进主 tab 栏，往期活动抽屉可见
 */
export type WindChimeTopicState =
  | 'default'
  | 'active'
  | 'scheduled'
  | 'ended'
  | 'archived';

/**
 * 单个主题的完整视图（管理端 / 公开端返回值的 union）。
 *
 * 公开端接口（`GET /api/mail/topics` 无密码）通常只返回 `default` 外的
 * `active` 主题；管理端接口返回全部（`note / unreadCount / flaggedCount`
 * 仅管理端可见，字段可为空）。
 */
export type WindChimeTopic = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  /** 管理端备注，访客不可见 */
  note?: string | null;
  isDefault: boolean;
  isEnabled: boolean;
  /** ISO Z 字符串；为 null 表示"立即开放" */
  startsAt: string | null;
  /** ISO Z 字符串；为 null 表示"长期开放" */
  endsAt: string | null;
  /** ISO Z 字符串；非 null 即已归档 */
  archivedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** 派生字段，由服务器计算 */
  state: WindChimeTopicState;
  /** 当前时刻是否可以投信（= `isEnabled` + 时间窗检查的服务器结果） */
  isEnabledNow: boolean;
  /** 仅管理端返回 */
  unreadCount?: number;
  /** 仅管理端返回 */
  flaggedCount?: number;
};

/** `GET /api/mail/topics` 的响应 */
export type WindChimeTopicListResponse = {
  items: WindChimeTopic[];
};

/**
 * `DELETE /api/mail/topics/{id}` 的响应；服务器在归档时一并返回未读 /
 * 待审核数量，前端据此决定是否弹二次确认（见 `WindChimeArchiveConfirmModal`）。
 */
export type WindChimeTopicArchiveResponse = {
  topic: WindChimeTopic;
  unreadCount: number;
  flaggedCount: number;
};

/**
 * `POST /api/mail/topics` 的请求体（创建）。
 * 服务器会忽略 `id` / `isDefault` / `createdAt` 等字段（永远为 0 / 服务端生成）。
 */
export type WindChimeTopicCreateInput = {
  slug: string;
  title: string;
  description?: string | null;
  note?: string | null;
  /** ISO Z 字符串；传 null 或不传视为"立即开放" */
  startsAt?: string | null;
  /** ISO Z 字符串；传 null 或不传视为"长期开放" */
  endsAt?: string | null;
  /** 默认为 true */
  isEnabled?: boolean;
  sortOrder?: number;
};

/**
 * `PATCH /api/mail/topics/{id}` 的请求体（部分更新）。
 * 想恢复已归档主题，传 `{ archivedAt: null }`。
 */
export type WindChimeTopicPatchInput = {
  title?: string;
  description?: string | null;
  note?: string | null;
  isEnabled?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  archivedAt?: string | null;
  sortOrder?: number;
};

/** 状态 → 中文短标签（tab / 统计面板 / 抽屉复用） */
export function windChimeTopicStateLabel(state: WindChimeTopicState): string {
  switch (state) {
    case 'default':
      return '常规';
    case 'active':
      return '进行中';
    case 'scheduled':
      return '未开始';
    case 'ended':
      return '已结束';
    case 'archived':
      return '已归档';
  }
}

/**
 * 返回当前时刻该主题是否应当接受投信。
 *
 * 逻辑：非归档 + isEnabled + 在时间窗内。主要用于客户端二次校验
 * （服务端仍是最终真相）。
 */
export function isWindChimeTopicOpenNow(topic: WindChimeTopic, now = new Date()): boolean {
  if (topic.archivedAt) return false;
  if (!topic.isEnabled) return false;
  const t = now.getTime();
  if (topic.startsAt && new Date(topic.startsAt).getTime() > t) return false;
  if (topic.endsAt && new Date(topic.endsAt).getTime() < t) return false;
  return true;
}

/**
 * slug 的客户端正则校验；服务端仍需做最终检查。
 * - 长度 1~64
 * - 字符集 `a-z0-9-`
 * - 首尾必须是字母 / 数字
 */
export const WIND_CHIME_TOPIC_SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * 推荐的 slug 保留字黑名单（与 Next.js / 常见 REST 路径段冲突）。
 * 宿主可以在 `WindChimeNewTopicModal` 的 `reservedSlugs` 里覆盖。
 */
export const WIND_CHIME_TOPIC_RESERVED_SLUGS: readonly string[] = [
  'default',
  'new',
  'admin',
  'api',
  'm',
];
