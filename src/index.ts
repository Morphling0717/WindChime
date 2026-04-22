/* ============================================================
 *  核心组件
 * ============================================================ */
export { WindChimeSender } from './components/WindChimeSender';
export { WindChimeAdminPanel } from './components/WindChimeAdminPanel';
export { WindChimeBlocklistPanel } from './components/WindChimeBlocklistPanel';

/* ============================================================
 *  二维码 / 海报
 * ============================================================ */
export { WindChimeQrCard } from './components/WindChimeQrCard';
export type {
  WindChimeQrCardProps,
  WindChimeQrCardTheme,
  QrCodeLike,
} from './components/WindChimeQrCard';
export {
  WindChimeQrPosterEditor,
  DEFAULT_POSTER_CONFIG,
} from './components/WindChimeQrPosterEditor';
export type {
  WindChimeQrPosterEditorProps,
  WindChimeQrPosterEditorTheme,
  WindChimeQrPosterConfig,
} from './components/WindChimeQrPosterEditor';

/* ============================================================
 *  浮动按钮 / Speed-Dial
 * ============================================================ */
export { WindChimeFloatingButton } from './components/WindChimeFloatingButton';
export type {
  WindChimeFloatingButtonProps,
  WindChimeFloatingButtonTheme,
} from './components/WindChimeFloatingButton';
export { WindChimeSpeedDial } from './components/WindChimeSpeedDial';
export type {
  WindChimeSpeedDialProps,
  WindChimeSpeedDialItem,
  WindChimeSpeedDialTheme,
} from './components/WindChimeSpeedDial';

/* ============================================================
 *  Turnstile（进阶）
 * ============================================================ */
export { TurnstileWidget } from './components/TurnstileWidget';
export type { TurnstileWidgetHandle } from './components/TurnstileWidget';

/* ============================================================
 *  审核 & 敏感词
 * ============================================================ */
export { WindChimeFlaggedPanel } from './components/WindChimeFlaggedPanel';
export type {
  WindChimeFlaggedPanelProps,
  WindChimeFlaggedPanelTheme,
  WindChimeFlaggedDetail,
} from './components/WindChimeFlaggedPanel';
export { WindChimeBlockedTermsPanel } from './components/WindChimeBlockedTermsPanel';
export type {
  WindChimeBlockedTermsPanelProps,
  WindChimeBlockedTermsPanelTheme,
} from './components/WindChimeBlockedTermsPanel';

/* ============================================================
 *  Mail Topics（多主题收件箱）
 * ============================================================ */
export { WindChimeTopicTabs } from './components/WindChimeTopicTabs';
export type {
  WindChimeTopicTabsProps,
  WindChimeTopicTabsLabels,
  WindChimeTopicTabsTheme,
} from './components/WindChimeTopicTabs';
export { WindChimeTopicStatePage } from './components/WindChimeTopicStatePage';
export type {
  WindChimeTopicStatePageProps,
  WindChimeTopicStatePageTheme,
  WindChimeTopicStateVariant,
} from './components/WindChimeTopicStatePage';
export { WindChimeActiveTopicsBanner } from './components/WindChimeActiveTopicsBanner';
export type {
  WindChimeActiveTopicsBannerProps,
  WindChimeActiveTopicsBannerTheme,
} from './components/WindChimeActiveTopicsBanner';
export { WindChimeNewTopicModal } from './components/WindChimeNewTopicModal';
export type {
  WindChimeNewTopicModalProps,
  WindChimeNewTopicModalLabels,
  WindChimeNewTopicModalTheme,
} from './components/WindChimeNewTopicModal';
export { WindChimeArchiveConfirmModal } from './components/WindChimeArchiveConfirmModal';
export type {
  WindChimeArchiveConfirmModalProps,
  WindChimeArchiveConfirmModalLabels,
  WindChimeArchiveConfirmModalTheme,
} from './components/WindChimeArchiveConfirmModal';
export { WindChimeArchivedTopicsDrawer } from './components/WindChimeArchivedTopicsDrawer';
export type {
  WindChimeArchivedTopicsDrawerProps,
  WindChimeArchivedTopicsDrawerLabels,
  WindChimeArchivedTopicsDrawerTheme,
} from './components/WindChimeArchivedTopicsDrawer';

/* ============================================================
 *  Mail Topics 类型与常量
 * ============================================================ */
export {
  windChimeTopicStateLabel,
  isWindChimeTopicOpenNow,
  WIND_CHIME_TOPIC_RESERVED_SLUGS,
  WIND_CHIME_TOPIC_SLUG_REGEX,
} from './types-topics';
export type {
  WindChimeTopic,
  WindChimeTopicState,
  WindChimeTopicListResponse,
  WindChimeTopicArchiveResponse,
  WindChimeTopicCreateInput,
  WindChimeTopicPatchInput,
} from './types-topics';

/* ============================================================
 *  时间 / 时区工具
 * ============================================================ */
export {
  WIND_CHIME_DEFAULT_TIME_ZONE,
  windChimeLocalToUtcIso,
  windChimeUtcIsoToLocal,
  windChimeNowAsLocal,
  windChimePlusDaysAsLocal,
  windChimeFormatInTimeZone,
} from './time';

/* ============================================================
 *  基础类型（保持既有 API 向下兼容）
 * ============================================================ */
export type {
  WindChimeAdminPanelProps,
  WindChimeAdminTheme,
  WindChimeBlockedSender,
  WindChimeBlocklistPanelProps,
  WindChimeInboxFilter,
  WindChimeMessageRecord,
  WindChimeRateLimit,
  WindChimeSenderProps,
  WindChimeSubmitPayload,
  WindChimeTheme,
} from './types';
