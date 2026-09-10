export type WindChimeLiveAsset = {
  id: string; caption: string; mimeType: string; width: number; height: number; sha256: string;
};
export type WindChimeLiveDraft = {
  text: string; nickname: string | null; linkUrl: string | null;
  assets: Array<{ id: string; caption: string }>;
};
export type WindChimeLiveAppearance = {
  fontFamily: string; fontSize: number; textColor: string; backgroundColor: string;
  transparent: boolean; layout: "card" | "letter" | "minimal";
  imageLayout: "row" | "column" | "grid";
  animation: "none" | "fade" | "slide"; borderRadius: number; padding: number;
};
export const DEFAULT_WINDCHIME_LIVE_APPEARANCE: WindChimeLiveAppearance = {
  fontFamily: "system-ui", fontSize: 32, textColor: "#ffffff", backgroundColor: "#18202eee",
  transparent: true, layout: "card", imageLayout: "column", animation: "fade", borderRadius: 24, padding: 32,
};
export type WindChimeLiveSnapshot = WindChimeLiveDraft & {
  id: string; messageId: string; assets: WindChimeLiveAsset[];
};
export type WindChimeLiveMessage = {
  id: string; createdAt: string; isRead: boolean; isFavorited: boolean; isFlagged: boolean;
  source: WindChimeLiveDraft; draft: WindChimeLiveDraft; draftRevision: number;
  status: "pending" | "approved" | "rejected"; snapshotId: string | null;
};
export type WindChimeLiveControlState = {
  topicId: string; revision: number; epoch: string; messages: WindChimeLiveMessage[];
  queue: string[]; current: { messageId: string; snapshotId: string } | null;
  appearance: WindChimeLiveAppearance; receivers: number;
};
export type WindChimeLiveFrame = {
  receiverId: string; epoch: string; revision: number; activation: number; leaseMs: number;
  appearance: WindChimeLiveAppearance; snapshot: WindChimeLiveSnapshot | null;
};
export type WindChimeLiveAction = {
  topicId: string;
  action: "draft" | "approve" | "reject" | "revoke" | "show" | "next" | "hide" | "end" | "reorder" | "appearance";
  messageId?: string; expectedRevision: number; expectedDraftRevision?: number;
  operationId: string; draft?: WindChimeLiveDraft; order?: string[];
  appearance?: Partial<WindChimeLiveAppearance>;
};
export type WindChimeLiveGrant = {
  id: string; kind: "display" | "control"; topicId: string; label: string;
  expiresAt: string; revokedAt: string | null;
};
