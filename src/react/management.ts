"use client";
import { useState, useEffect } from "react";
import type { WindChimeClient } from "../client/index.js";
import type {
  WindChimeTopicCreateInput,
  WindChimeTopicPatchInput,
  WindChimeTopic,
  WindChimeBlockedSender,
  WindChimePublicTopic,
  WindChimeAdminTopic,
} from "../core/index.js";
import {
  useWindChimeResource,
  useWindChimeMutation,
  type WindChimeResourceOptions,
} from "./resource.js";
import { useWindChimeInbox } from "./inbox.js";
const emptyTopics: WindChimeTopic[] = [];
const emptyTerms: string[] = [];
const emptyBlocklist: WindChimeBlockedSender[] = [];

export function useWindChimeTopics<Mode extends "admin" | "public" = "admin">(
  client: WindChimeClient,
  options: WindChimeResourceOptions & {
    includeArchived?: boolean;
    mode?: Mode;
  } = {},
) {
  const includeArchived = options.includeArchived !== false;
  type Topic = Mode extends "public"
    ? WindChimePublicTopic
    : WindChimeAdminTopic;
  const mode = options.mode ?? "admin";
  const resource = useWindChimeResource<{ items: Topic[] }>(
    client,
    "topics",
    `${mode}:${includeArchived}`,
    async (signal) =>
      (mode === "public"
        ? client.topics.listPublic({ signal })
        : client.topics.listAdmin({ includeArchived, signal })) as Promise<{
        items: Topic[];
      }>,
    options,
  );
  const mutation = useWindChimeMutation();
  return {
    ...resource,
    items: resource.data?.items ?? (emptyTopics as Topic[]),
    pending: mutation.pending,
    mutationError: mutation.mutationError,
    create: (input: WindChimeTopicCreateInput) =>
      mutation.run(() => client.topics.create(input)),
    update: (id: string, patch: WindChimeTopicPatchInput) =>
      mutation.run(() => client.topics.update(id, patch)),
    archive: (id: string, opts?: { markReadFirst?: boolean }) =>
      mutation.run(() => client.topics.archive(id, opts)),
    restore: (id: string) => mutation.run(() => client.topics.restore(id)),
    purge: (id: string) => mutation.run(() => client.topics.purge(id)),
  };
}
export function useWindChimeSettings(
  client: WindChimeClient,
  options: WindChimeResourceOptions = {},
) {
  const resource = useWindChimeResource(
    client,
    "settings",
    "",
    (signal) => client.settings.get({ signal }),
    options,
  );
  const mutation = useWindChimeMutation();
  return {
    ...resource,
    pending: mutation.pending,
    mutationError: mutation.mutationError,
    setEnabled: (enabled: boolean) =>
      mutation.run(() => client.settings.set(enabled)),
  };
}
export function useWindChimeBlockedTerms(
  client: WindChimeClient,
  options: WindChimeResourceOptions = {},
) {
  const resource = useWindChimeResource(
    client,
    "blockedTerms",
    "",
    (signal) => client.blockedTerms.get({ signal }),
    options,
  );
  const mutation = useWindChimeMutation();
  return {
    ...resource,
    terms: resource.data?.terms ?? emptyTerms,
    pending: mutation.pending,
    mutationError: mutation.mutationError,
    save: (terms: string[]) =>
      mutation.run(() => client.blockedTerms.set(terms)),
  };
}
export function useWindChimeBlocklist(
  client: WindChimeClient,
  options: WindChimeResourceOptions = {},
) {
  const resource = useWindChimeResource(
    client,
    "blocklist",
    "",
    (signal) => client.blocklist.list({ signal }),
    options,
  );
  const mutation = useWindChimeMutation();
  return {
    ...resource,
    items: resource.data ?? emptyBlocklist,
    pending: mutation.pending,
    mutationError: mutation.mutationError,
    unblock: (hash: string) =>
      mutation.run(() => client.blocklist.unblock(hash)),
  };
}
export function useWindChimeReview(
  client: WindChimeClient,
  options: WindChimeResourceOptions & { topicId?: string } = {},
) {
  const topicId = options.topicId ?? "default";
  const inbox = useWindChimeInbox(client, { ...options, filter: "flagged" });
  const [target, setTarget] = useState<{ topicId: string; id: string } | null>(
    null,
  );
  useEffect(() => {
    setTarget(null);
  }, [topicId, options.enabled]);
  const id = target?.topicId === topicId ? target.id : null;
  const detail = useWindChimeResource(
    client,
    "messages",
    `${topicId}:${id}`,
    (signal) => client.messages.detail(id!, { topicId, signal }),
    { enabled: options.enabled !== false && id !== null },
  );
  return {
    ...inbox,
    detail: detail.data,
    detailLoading: detail.isLoading,
    detailError: detail.error,
    openDetail: (messageId: string) => setTarget({ topicId, id: messageId }),
    closeDetail: () => setTarget(null),
    approve: async (messageId: string) => {
      const result = await inbox.update(messageId, { isFlagged: false });
      setTarget((old) =>
        old?.topicId === topicId && old.id === messageId ? null : old,
      );
      return result;
    },
  };
}

const callbackSource = { subscribe: () => () => {} };
/** Lazy detail state for a custom transport; closing or changing scope immediately hides the prior raw content. */
export function useWindChimeDetail<T>(
  loadDetail: (id: string) => Promise<T>,
  options: { id?: string | null; scope?: string; enabled?: boolean },
) {
  const id = options.id;
  const resource = useWindChimeResource(
    callbackSource,
    "messages",
    `${options.scope ?? ""}:${id ?? ""}`,
    () => loadDetail(id!),
    { enabled: options.enabled !== false && !!id },
  );
  return {
    detail: resource.data,
    isLoading: resource.isLoading,
    error: resource.error,
    reload: resource.reload,
  };
}
