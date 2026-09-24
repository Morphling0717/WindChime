"use client";
import { useEffect, useRef, useState } from "react";
import type { WindChimeSubmitPayload } from "../core/index.js";
import { WindChimeClientError } from "../client/index.js";

export type WindChimeAttachmentReceipt = { id: string; receipt: string };
/** Upload immediately before submission so a single Turnstile proof covers the batch. */
export async function uploadWindChimeAttachments(options: {
  files: File[]; topicId: string; turnstileToken?: string | null;
  baseUrl?: string; fetch?: typeof fetch; signal?: AbortSignal;
}): Promise<WindChimeAttachmentReceipt[]> {
  if (!options.files.length) return [];
  if (options.files.length > 3 || options.files.some(file => file.size > 5 * 1024 * 1024))
    throw new WindChimeClientError("INVALID_IMAGES", 400, "每封最多 3 张图片，每张不超过 5 MiB");
  const body = new FormData();
  body.set("topicId", options.topicId);
  if (options.turnstileToken) body.set("turnstileToken", options.turnstileToken);
  for (const file of options.files) body.append("file", file);
  const response = await (options.fetch ?? fetch)(`${options.baseUrl ?? "/api/mail/live"}/upload`, {
    method: "POST", body, signal: options.signal, credentials: "omit", cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new WindChimeClientError(result.code ?? "UPLOAD_FAILED", response.status, result.error ?? "图片上传失败");
  const attachments = result.attachments ?? [result];
  if (attachments.length !== options.files.length || attachments.some((a: WindChimeAttachmentReceipt) => !a.id || !a.receipt))
    throw new WindChimeClientError("INVALID_RESPONSE", 502, "图片上传响应不完整");
  return attachments.map((a: WindChimeAttachmentReceipt) => ({ id: a.id, receipt: a.receipt }));
}

export function useWindChimeAttachments(topicId = "default", baseUrl?: string) {
  const [files, setFiles] = useState<File[]>([]);
  const cache = useRef<{ files: File[]; receipts: WindChimeAttachmentReceipt[] } | null>(null);
  const scope = useRef(topicId);
  scope.current = topicId;
  useEffect(() => { setFiles([]); cache.current = null; }, [topicId]);
  return {
    files, setFiles,
    clear() { setFiles([]); cache.current = null; },
    async attach(payload: WindChimeSubmitPayload): Promise<WindChimeSubmitPayload> {
      if (!files.length) return payload;
      if (!cache.current || cache.current.files !== files) {
        const receipts = await uploadWindChimeAttachments({ files, topicId, baseUrl, turnstileToken: payload.turnstileToken });
        if (scope.current !== topicId) throw new WindChimeClientError("TOPIC_CHANGED", 409, "话题已切换，请重新选择图片");
        cache.current = { files, receipts };
      }
      return { ...payload, topicSlug: payload.topicSlug ?? topicId, attachments: cache.current.receipts };
    },
  };
}
