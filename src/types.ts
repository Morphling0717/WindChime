import type { ReactNode } from "react";

/**
 * 通过 className 片段换肤；未传的键会使用内置默认（玻璃拟态 + 柔和渐变）。
 * 接入新项目时，通常只需改 `panel` / `primaryButton` / `statusOpen` 等几处。
 */
export type WindChimeTheme = {
  root?: string;
  panel?: string;
  header?: string;
  title?: string;
  statusOpen?: string;
  statusPaused?: string;
  tagline?: string;
  textarea?: string;
  /** 昵称、外链等次要单行输入 */
  secondaryInput?: string;
  counter?: string;
  primaryButton?: string;
  primaryButtonDisabled?: string;
  secondaryButton?: string;
  successBanner?: string;
  errorBanner?: string;
  /** Turnstile 容器外框 */
  turnstileWrap?: string;
};

import type {
  WindChimeRateLimit,
  WindChimeSubmitPayload,
  WindChimeMessageRecord,
  WindChimeInboxFilter,
  WindChimeBlockedSender,
} from "./core/index.js";
export type {
  WindChimeRateLimit,
  WindChimeSubmitPayload,
  WindChimeMessageRecord,
  WindChimeInboxFilter,
  WindChimeBlockedSender,
} from "./core/index.js";

export type WindChimeSenderProps = {
  title?: ReactNode;
  statusOpenLabel?: string;
  statusPausedLabel?: string;
  status?: "open" | "paused";
  tagline?: string;
  placeholder?: string;
  maxLength?: number;
  successMessage?: string;
  /** 暂停且 `showWhenPaused=false` 时展示的说明（替代仅 tagline） */
  pausedMessage?: string;
  rateLimit?: WindChimeRateLimit | false;
  onSubmit: (payload: WindChimeSubmitPayload) => Promise<void>;
  successAudioSrc?: string;
  enableSwayAnimation?: boolean;
  theme?: WindChimeTheme;
  className?: string;
  showWhenPaused?: boolean;
  collectNickname?: boolean;
  nicknamePlaceholder?: string;
  nicknameMaxLength?: number;
  collectLinkUrl?: boolean;
  linkPlaceholder?: string;
  linkMaxLength?: number;
  /** Cloudflare Turnstile 站点密钥；设置后渲染验证框并在提交时附带 token */
  turnstileSiteKey?: string;
  /** 命中任一子串（不区分大小写）时阻止提交并提示 */
  blockedTerms?: string[];
  /** 命中 blockedTerms 时的提示文案 */
  blockedTermsMessage?: string;
  /** 关闭匿名发送者指纹生成；默认开启 */
  disableSenderFingerprint?: boolean;
  /** 匿名发送者指纹 localStorage 键名，默认 `windchime:fp` */
  senderFingerprintKey?: string;
};

export type WindChimeAdminPanelProps = {
  items: WindChimeMessageRecord[];
  isLoading?: boolean;
  error?: string | null;
  title?: ReactNode;
  emptyText?: string;
  /** 统计数量：不传则按 items 自行推算 */
  counts?: Partial<Record<WindChimeInboxFilter, number>>;
  /** 当前分类；若提供则为受控（需同时提供 onFilterChange） */
  filter?: WindChimeInboxFilter;
  /** 默认分类（非受控时初始值）；默认 `all` */
  defaultFilter?: WindChimeInboxFilter;
  onFilterChange?: (filter: WindChimeInboxFilter) => void;
  /** 非受控模式下，是否在组件内按 items 自动过滤；默认 true */
  autoClientFilter?: boolean;
  onReload?: () => void;
  onDelete?: (id: string) => Promise<void>;
  onToggleRead?: (id: string, isRead: boolean) => Promise<void>;
  onToggleFavorite?: (id: string, isFavorited: boolean) => Promise<void>;
  onBlockSender?: (id: string) => Promise<void>;
  onBatchDelete?: (ids: string[]) => Promise<void>;
  onBatchMarkRead?: (ids: string[]) => Promise<void>;
  onExportCsv?: () => void;
  theme?: WindChimeAdminTheme;
  className?: string;
};

export type WindChimeBlocklistPanelProps = {
  items: WindChimeBlockedSender[];
  isLoading?: boolean;
  error?: string | null;
  title?: ReactNode;
  emptyText?: string;
  onReload?: () => void;
  onUnblock?: (hash: string) => Promise<void>;
  theme?: WindChimeAdminTheme;
  className?: string;
};

export type WindChimeAdminTheme = {
  root?: string;
  toolbar?: string;
  /** 分类 Tab 栏容器 */
  tabs?: string;
  tab?: string;
  tabActive?: string;
  button?: string;
  primaryButton?: string;
  dangerButton?: string;
  /** 被选中的行样式（受选中态控制） */
  rowSelected?: string;
  tableWrap?: string;
  table?: string;
  th?: string;
  td?: string;
  checkbox?: string;
  /** 收藏/星标按钮 active 样式 */
  favoriteActive?: string;
  /** 单行徽标（如 User-XXXX、未读点） */
  badge?: string;
  link?: string;
  muted?: string;
  /** 留言卡片网格容器 */
  cardGrid?: string;
  /** 单张留言卡片 */
  card?: string;
  /** 未读卡片额外样式 */
  cardUnread?: string;
  /** 已收藏卡片额外样式 */
  cardFavorited?: string;
};
