"use client";
import { useMemo, useRef } from "react";
import { createWindChimeClient } from "@windchime/embed/client";
import {
  useWindChimeSubmission,
  useWindChimeTurnstile,
} from "@windchime/embed/react";

// Labels belong to this example. The headless hook exposes codes and values for any UI.
const errors: Record<string, string> = {
  TEXT_REQUIRED: "请填写内容。",
  TEXT_TOO_LONG: "内容不能超过 1000 字符。",
  NICKNAME_TOO_LONG: "称呼不能超过 32 字符。",
  LINK_TOO_LONG: "链接不能超过 500 字符。",
  INVALID_LINK: "请填写有效的 http 或 https 链接。",
  TURNSTILE_REQUIRED: "请先完成验证。",
  SUBMISSIONS_CLOSED: "此话题目前不接收投稿。",
  TOPIC_NOT_FOUND: "此话题不存在。",
  REQUEST_FAILED: "网络请求失败，请稍后重试。",
  BLOCKED_TERM: "请修改内容后重试。",
};
export function Sender({
  slug = "default",
  enabled = true,
}: {
  slug?: string;
  enabled?: boolean;
}) {
  const client = useMemo(() => createWindChimeClient(), []);
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const form = useWindChimeSubmission({
    client,
    topicSlug: slug,
    enabled,
    requireTurnstile: !!siteKey,
  });
  const challengeRef = useRef<HTMLDivElement>(null);
  const challenge = useWindChimeTurnstile(challengeRef, {
    siteKey,
    onToken: form.setTurnstileToken,
  });
  const failure =
    form.error?.code === "RATE_LIMITED"
      ? `请在 ${Math.ceil((form.retryAfterMs || form.error.retryAfterMs || 1000) / 1000)} 秒后再试。`
      : form.error
        ? (errors[form.error.code] ?? form.error.message)
        : null;
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        await form.submit();
        // A failed server submission may have consumed the challenge token too.
        challenge.reset();
      }}
    >
      <label>
        内容
        <textarea
          aria-label="内容"
          value={form.text}
          onChange={(event) => form.setText(event.target.value)}
          maxLength={1000}
          disabled={form.sending || !enabled}
          required
        />
      </label>
      <label>
        称呼（可选）
        <input
          value={form.nickname}
          onChange={(event) => form.setNickname(event.target.value)}
          maxLength={32}
          disabled={form.sending || !enabled}
        />
      </label>
      <label>
        链接（可选）
        <input
          value={form.linkRaw}
          onChange={(event) => form.setLinkRaw(event.target.value)}
          maxLength={500}
          disabled={form.sending || !enabled}
        />
      </label>
      <div ref={challengeRef} />
      <button disabled={!form.canSubmit}>
        {form.sending ? "发送中" : "投递"}
      </button>
      {!enabled && <p>此话题目前不接收投稿。</p>}
      {form.success && <p role="status">投递成功。</p>}
      {failure && <p role="alert">{failure}</p>}
      {challenge.error && (
        <p role="alert">验证加载失败，请检查网络后刷新页面。</p>
      )}
    </form>
  );
}
