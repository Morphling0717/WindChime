import type { WindChimeSubmitPayload } from "./index.js";
import { WindChimeError } from "./errors.js";
import {
  WIND_CHIME_TOPIC_RESERVED_SLUGS,
  WIND_CHIME_TOPIC_SLUG_REGEX,
  type WindChimeTopicCreateInput,
  type WindChimeTopicPatchInput,
} from "../types-topics.js";
export function fail(code: string, message: string, status = 400): never {
  throw new WindChimeError(code, status, message);
}
export function objectInput(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_BODY", "请求体必须是 JSON 对象");
  return value as Record<string, unknown>;
}
export function onlyFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  const invalid = Object.keys(value).find((key) => !allowed.includes(key));
  if (invalid) fail("INVALID_FIELD", `不支持的字段: ${invalid}`);
}
export function textInput(
  value: unknown,
  max: number,
  field: string,
  required = false,
): string | null {
  if (value == null || value === "") {
    if (required) fail("INVALID_INPUT", `${field}不能为空`);
    return null;
  }
  if (typeof value !== "string") fail("INVALID_INPUT", `${field}必须是字符串`);
  const result = value.trim();
  if (required && !result) fail("INVALID_INPUT", `${field}不能为空`);
  if (result.length > max) fail("INVALID_INPUT", `${field}最多 ${max} 字符`);
  return result || null;
}
export function boolInput(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail("INVALID_INPUT", `${field}必须是布尔值`);
  return value;
}
export function integerInput(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    fail("INVALID_INPUT", "sortOrder 必须是整数");
  return value;
}
export function dateInput(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    fail("TIME_INVALID", "时间必须是包含时区的 ISO 8601 字符串");
  return new Date(value).toISOString();
}
export function timeRange(start: string | null, end: string | null) {
  if (start && end && start > end)
    fail("TIME_RANGE_INVALID", "开始时间不能晚于结束时间");
}
export function slugInput(value: unknown): string {
  const slug = textInput(value, 64, "slug", true)!;
  if (!WIND_CHIME_TOPIC_SLUG_REGEX.test(slug))
    fail(
      "SLUG_INVALID",
      "slug 只接受小写字母、数字、短横，首尾必须是字母或数字",
    );
  if (WIND_CHIME_TOPIC_RESERVED_SLUGS.includes(slug))
    fail("SLUG_RESERVED", "slug 是保留字");
  return slug;
}
export function linkInput(value: unknown, maxLength = 500): string | null {
  const input = textInput(value, maxLength, "链接");
  if (!input) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input))
    fail("INVALID_LINK", "仅支持 http(s) 链接");
  try {
    const url = new URL(
      /^https?:\/\//i.test(input) ? input : `https://${input}`,
    );
    if (!["http:", "https:"].includes(url.protocol))
      fail("INVALID_LINK", "仅支持 http(s) 链接");
    return url.toString();
  } catch {
    return fail("INVALID_LINK", "链接格式无效");
  }
}
export function validateWindChimeTopicCreate(
  input: WindChimeTopicCreateInput,
): WindChimeTopicCreateInput {
  const raw = objectInput(input);
  onlyFields(raw, [
    "slug",
    "title",
    "description",
    "note",
    "isEnabled",
    "startsAt",
    "endsAt",
    "sortOrder",
  ]);
  const result: WindChimeTopicCreateInput = {
    slug: slugInput(raw.slug),
    title: textInput(raw.title, 64, "标题", true)!,
    description: textInput(raw.description, 500, "描述"),
    note: textInput(raw.note, 500, "备注"),
    startsAt: dateInput(raw.startsAt),
    endsAt: dateInput(raw.endsAt),
    isEnabled:
      raw.isEnabled === undefined
        ? true
        : boolInput(raw.isEnabled, "isEnabled"),
    sortOrder: raw.sortOrder === undefined ? 0 : integerInput(raw.sortOrder),
  };
  timeRange(result.startsAt ?? null, result.endsAt ?? null);
  return result;
}
export function validateWindChimeTopicPatch(
  input: WindChimeTopicPatchInput,
): WindChimeTopicPatchInput {
  const raw = objectInput(input);
  if ("slug" in raw) fail("SLUG_NOT_EDITABLE", "slug 创建后不可修改");
  onlyFields(raw, [
    "title",
    "description",
    "note",
    "isEnabled",
    "startsAt",
    "endsAt",
    "sortOrder",
    "archivedAt",
  ]);
  const result: WindChimeTopicPatchInput = {};
  if ("title" in raw) result.title = textInput(raw.title, 64, "标题", true)!;
  if ("description" in raw)
    result.description = textInput(raw.description, 500, "描述");
  if ("note" in raw) result.note = textInput(raw.note, 500, "备注");
  if ("isEnabled" in raw)
    result.isEnabled = boolInput(raw.isEnabled, "isEnabled");
  if ("startsAt" in raw) result.startsAt = dateInput(raw.startsAt);
  if ("endsAt" in raw) result.endsAt = dateInput(raw.endsAt);
  if ("sortOrder" in raw) result.sortOrder = integerInput(raw.sortOrder);
  if ("archivedAt" in raw) {
    if (raw.archivedAt !== null)
      fail("INVALID_INPUT", "archivedAt 只接受 null（恢复）");
    result.archivedAt = null;
  }
  if ("startsAt" in result && "endsAt" in result)
    timeRange(result.startsAt ?? null, result.endsAt ?? null);
  return result;
}

export function validateWindChimeSubmission(
  payload: WindChimeSubmitPayload,
  limits: {
    maxLength?: number;
    nicknameMaxLength?: number;
    linkMaxLength?: number;
  } = {},
): WindChimeSubmitPayload {
  objectInput(payload);
  return {
    ...payload,
    text: textInput(payload.text, limits.maxLength ?? 1000, "正文", true)!,
    nickname: textInput(
      payload.nickname,
      limits.nicknameMaxLength ?? 32,
      "称呼",
    ),
    linkUrl: linkInput(payload.linkUrl, limits.linkMaxLength ?? 500),
  };
}
