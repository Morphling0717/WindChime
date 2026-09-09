"use client";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import type {
  WindChimeClient,
  WindChimeCounts,
  WindChimeMessagePatch,
} from "../client/index.js";
import type {
  WindChimeInboxFilter,
  WindChimeMessageRecord,
} from "../core/index.js";
import {
  useWindChimeMutation,
  useWindChimeResource,
  type WindChimeResourceOptions,
} from "./resource.js";

export {
  filterWindChimeMessages,
  countWindChimeMessages,
} from "../core/index.js";
export function useWindChimeSelection(ids: readonly string[], scope = "") {
  const liveScope = useRef(scope);
  const revision = useRef(0);
  if (liveScope.current !== scope) {
    liveScope.current = scope;
    ++revision.current;
  }
  const generation = revision.current;
  const [selection, setSelection] = useState<{
    scope: string;
    revision: number;
    ids: Set<string>;
  }>({ scope, revision: generation, ids: new Set() });
  const idKey = JSON.stringify(ids);
  const selectedIds = useMemo(
    () =>
      new Set(
        selection.scope === scope && selection.revision === generation
          ? [...selection.ids].filter((id) => ids.includes(id))
          : [],
      ),
    [selection, scope, generation, idKey],
  );
  useEffect(() => {
    setSelection((old) => ({
      scope,
      revision: generation,
      ids: new Set(
        old.scope === scope && old.revision === generation
          ? [...old.ids].filter((id) => ids.includes(id))
          : [],
      ),
    }));
  }, [scope, generation, idKey]);
  const clearSelection = useCallback(
    () =>
      setSelection((old) =>
        old.scope === scope && old.revision === generation
          ? { scope, revision: generation, ids: new Set() }
          : old,
      ),
    [scope, generation],
  );
  const toggleSelected = (id: string) => {
    if (!ids.includes(id)) return;
    setSelection((old) => {
      const next = new Set(
        old.scope === scope && old.revision === generation ? old.ids : [],
      );
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { scope, revision: generation, ids: next };
    });
  };
  const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
  const toggleAll = () =>
    setSelection({
      scope,
      revision: generation,
      ids: allSelected ? new Set() : new Set(ids),
    });
  return {
    selectedIds,
    toggleSelected,
    toggleAll,
    clearSelection,
    allSelected,
    someSelected: selectedIds.size > 0,
  };
}
const emptyItems: WindChimeMessageRecord[] = [];
const emptyCounts: WindChimeCounts = {
  all: 0,
  unread: 0,
  favorited: 0,
  flagged: 0,
};
export function useWindChimeInbox(
  client: WindChimeClient,
  options: WindChimeResourceOptions & {
    topicId?: string;
    filter?: WindChimeInboxFilter;
  } = {},
) {
  const topicId = options.topicId ?? "default";
  const [filter, setFilter] = useState<WindChimeInboxFilter>(
    options.filter ?? "all",
  );
  useEffect(() => {
    if (options.filter) setFilter(options.filter);
  }, [options.filter]);
  const scope = `${topicId}:${filter}`;
  const resource = useWindChimeResource(
    client,
    "messages",
    scope,
    (signal) => client.messages.list({ topicId, filter, signal }),
    options,
  );
  const mutation = useWindChimeMutation(scope);
  const items = resource.data?.items ?? emptyItems;
  const selection = useWindChimeSelection(
    items.map((item) => item.id),
    scope,
  );
  const update = (id: string, patch: WindChimeMessagePatch) =>
    mutation.run(() => client.messages.update(id, patch, { topicId }));
  return {
    ...resource,
    ...selection,
    items,
    counts: resource.data?.counts ?? emptyCounts,
    filter,
    setFilter,
    pending: mutation.pending,
    mutationError: mutation.mutationError,
    update,
    markRead: (id: string, isRead = true) => update(id, { isRead }),
    toggleFavorite: (id: string, isFavorited?: boolean) =>
      update(id, {
        isFavorited:
          isFavorited ?? !items.find((item) => item.id === id)?.isFavorited,
      }),
    deleteMessage: (id: string) =>
      mutation.run(() => client.messages.delete(id, { topicId })),
    blockSender: (id: string) =>
      mutation.run(() => client.messages.block(id, { topicId })),
    batch: (action: "delete" | "markRead", ids = [...selection.selectedIds]) =>
      mutation.run(async () => {
        const result = await client.messages.batch(action, ids, { topicId });
        selection.clearSelection();
        return result;
      }),
    exportCsv: (rows = items) => client.exportCsv(rows),
  };
}
