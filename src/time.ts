/**
 * 时间 / 时区工具：
 *
 * 设计原则：
 * - DB 永远存 UTC Z 串（`2026-06-15T07:00:00.000Z`）；
 * - 主播可见的时间输入 / 展示默认走 `Asia/Shanghai`（北京时间），但所有
 *   函数都暴露 `timeZone` 形参，日后换其它时区亦可；
 * - HTML `<input type="datetime-local">` 的 value 是**无时区**本地字符串
 *   （`2026-06-15T15:00`），本模块提供 UTC ISO ↔ 本地字符串双向转换。
 */

/** 默认时区；几乎所有面向华语主播的场景都用 Asia/Shanghai */
export const WIND_CHIME_DEFAULT_TIME_ZONE = 'Asia/Shanghai';

/**
 * 把 `<input type="datetime-local">` 的 value 理解为指定时区的本地时间，
 * 转成 UTC ISO 串（`...Z`）。
 *
 * 例：
 * ```
 * windChimeLocalToUtcIso('2026-06-15T15:00', 'Asia/Shanghai')
 *   // => '2026-06-15T07:00:00.000Z'
 * ```
 *
 * 实现策略：先构造一个"该本地串 + 任意固定偏移"的 Date，读出它在目标
 * 时区被解读成的时刻，再回推真实 UTC。比直接拼 `+08:00` 更稳健，因为
 * 允许传任意 `timeZone`（比如 `America/Los_Angeles`，有 DST）。
 */
export function windChimeLocalToUtcIso(
  local: string,
  timeZone: string = WIND_CHIME_DEFAULT_TIME_ZONE,
): string {
  if (!local) return '';
  // 补齐秒：datetime-local 的 value 通常形如 `YYYY-MM-DDTHH:mm`
  const withSeconds = /\d{2}:\d{2}:\d{2}$/.test(local) ? local : `${local}:00`;

  // 1. 把 local 当 UTC 理解，得到 Date_A
  const asUtc = new Date(`${withSeconds}Z`);
  if (Number.isNaN(asUtc.getTime())) return '';

  // 2. 读 Date_A 在目标时区下"看起来是什么时间"
  // offsetMinutes = 目标时区当时相对 UTC 的偏移（分钟）
  const offsetMinutes = getTimeZoneOffsetMinutes(asUtc, timeZone);

  // 3. 真实 UTC = Date_A - offset（因为 local 本该在目标时区）
  const realUtc = new Date(asUtc.getTime() - offsetMinutes * 60_000);
  return realUtc.toISOString();
}

/**
 * 把 UTC ISO 串转成 `<input type="datetime-local">` 识别的本地字符串
 * （按指定时区理解）。
 *
 * 例：
 * ```
 * windChimeUtcIsoToLocal('2026-06-15T07:00:00Z', 'Asia/Shanghai')
 *   // => '2026-06-15T15:00'
 * ```
 */
export function windChimeUtcIsoToLocal(
  iso: string | null | undefined,
  timeZone: string = WIND_CHIME_DEFAULT_TIME_ZONE,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  // sv-SE locale = YYYY-MM-DD HH:mm，刚好能拼成 datetime-local
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

/** 给表单初值：当前时间在指定时区下的 datetime-local 形式 */
export function windChimeNowAsLocal(
  timeZone: string = WIND_CHIME_DEFAULT_TIME_ZONE,
): string {
  return windChimeUtcIsoToLocal(new Date().toISOString(), timeZone);
}

/** 给表单初值：当前时间 + N 天 */
export function windChimePlusDaysAsLocal(
  days: number,
  timeZone: string = WIND_CHIME_DEFAULT_TIME_ZONE,
): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return windChimeUtcIsoToLocal(d.toISOString(), timeZone);
}

/** UTC ISO → 友好的本地时间字符串（默认 `2026-06-15 15:00`） */
export function windChimeFormatInTimeZone(
  iso: string | null | undefined,
  options: {
    timeZone?: string;
    locale?: string;
    withSeconds?: boolean;
  } = {},
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const {
    timeZone = WIND_CHIME_DEFAULT_TIME_ZONE,
    locale = 'zh-CN',
    withSeconds = false,
  } = options;
  return d.toLocaleString(locale, {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  });
}

/**
 * 内部辅助：给定一个 Date 和时区，返回该时刻在目标时区相对 UTC 的偏移
 * （分钟）。正数 = 东时区（UTC+X），负数 = 西时区。
 *
 * 原理：用 Intl.DateTimeFormat 格式化成"目标时区的墙上时间"，再把那个
 * 字符串当 UTC 反解析一次，差值就是偏移。
 */
function getTimeZoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const pick = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';

  // 在部分 locale 下"24"会表示"次日 00"，做下归一化
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  const minute = pick('minute');
  const second = pick('second');

  // 把"目标时区墙上时间"当作 UTC 反解析
  const wallClockAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );

  // 差值 = 目标时区当时相对 UTC 的偏移（分钟）
  return Math.round((wallClockAsUtc - date.getTime()) / 60_000);
}
