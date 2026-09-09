/** Runtime-free domain contracts. Importing this entry never imports React or CSS. */
export * from "../types-topics.js";
export * from "../time.js";
import type { WindChimeTopic } from "../types-topics.js";
export type WindChimePublicTopic = Omit<
  WindChimeTopic,
  "note" | "unreadCount" | "flaggedCount"
>;
export type WindChimeAdminTopic = WindChimePublicTopic & {
  note: string | null;
  unreadCount?: number;
  flaggedCount?: number;
};
export type WindChimeInboxFilter = "all" | "unread" | "favorited" | "flagged";
export type WindChimeCounts = Record<WindChimeInboxFilter, number>;
export type WindChimeRateLimit = {
  max?: number;
  windowMs?: number;
  storageKey?: string;
};
export type WindChimeSubmitPayload = {
  text: string;
  nickname?: string | null;
  linkUrl?: string | null;
  turnstileToken?: string | null;
  senderFingerprint?: string | null;
  topicSlug?: string | null;
};
export type WindChimeMessageRecord = {
  id: string;
  topicId?: string;
  createdAt: string;
  text: string;
  nickname?: string | null;
  linkUrl?: string | null;
  isRead?: boolean;
  isFavorited?: boolean;
  isReplied?: boolean;
  replyText?: string | null;
  isFlagged?: boolean;
  senderLabel?: string | null;
  senderHash?: string | null;
};
export type WindChimeMessageList = {
  items: WindChimeMessageRecord[];
  counts: WindChimeCounts;
};
export type WindChimeBlockedSender = {
  hash: string;
  label?: string | null;
  blockedAt: string;
  sampleText?: string | null;
};
export { WindChimeError } from "./errors.js";
export {
  validateWindChimeTopicCreate,
  validateWindChimeTopicPatch,
  validateWindChimeSubmission,
} from "./validation.js";
/** Explicit allowlist: newly added admin fields cannot accidentally become public. */
export function toWindChimePublicTopic(
  topic: WindChimeTopic,
): WindChimePublicTopic {
  const {
    id,
    slug,
    title,
    description,
    isDefault,
    isEnabled,
    startsAt,
    endsAt,
    archivedAt,
    sortOrder,
    createdAt,
    updatedAt,
    state,
    isEnabledNow,
  } = topic;
  return {
    id,
    slug,
    title,
    description,
    isDefault,
    isEnabled,
    startsAt,
    endsAt,
    archivedAt,
    sortOrder,
    createdAt,
    updatedAt,
    state,
    isEnabledNow,
  };
}
export function normalizeWindChimeTerms(terms: readonly string[]): string[] {
  return [
    ...new Set(terms.map((term) => term.trim().toLowerCase()).filter(Boolean)),
  ];
}
export function matchWindChimeBlockedTerm(
  terms: readonly string[],
  ...fields: Array<string | null | undefined>
): string | null {
  const text = fields
    .filter((field) => typeof field === "string")
    .join("\n")
    .toLowerCase();
  return terms.find((term) => text.includes(term)) ?? null;
}
export function isWindChimeInboxFilter(
  value: string,
): value is WindChimeInboxFilter {
  return ["all", "unread", "favorited", "flagged"].includes(value);
}
export function filterWindChimeMessages(
  items: readonly WindChimeMessageRecord[],
  filter: WindChimeInboxFilter,
): WindChimeMessageRecord[] {
  return items.filter((item) =>
    filter === "flagged"
      ? item.isFlagged
      : !item.isFlagged &&
        (filter === "all" ||
          (filter === "unread" && !item.isRead) ||
          (filter === "favorited" && item.isFavorited)),
  );
}
export function countWindChimeMessages(
  items: readonly WindChimeMessageRecord[],
): WindChimeCounts {
  return {
    all: filterWindChimeMessages(items, "all").length,
    unread: filterWindChimeMessages(items, "unread").length,
    favorited: filterWindChimeMessages(items, "favorited").length,
    flagged: filterWindChimeMessages(items, "flagged").length,
  };
}
