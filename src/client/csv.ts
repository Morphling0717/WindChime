import type { WindChimeMessageRecord } from "../core/index.js";
export type WindChimeCsvColumn =
  | "id"
  | "createdAt"
  | "nickname"
  | "linkUrl"
  | "senderLabel"
  | "isRead"
  | "isFavorited"
  | "text";
const columns: WindChimeCsvColumn[] = [
  "id",
  "createdAt",
  "nickname",
  "linkUrl",
  "senderLabel",
  "isRead",
  "isFavorited",
  "text",
];
/** Escapes spreadsheet formulas as well as CSV quotes. No UI or download side effect. */
export function windChimeMessagesToCsv(
  rows: WindChimeMessageRecord[],
  options: {
    headers?: Partial<Record<WindChimeCsvColumn, string>>;
    bom?: boolean;
  } = {},
): string {
  const escape = (value: unknown) => {
    let text =
      value == null
        ? ""
        : typeof value === "boolean"
          ? value
            ? "1"
            : "0"
          : String(value);
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    (options.bom === false ? "" : "\uFEFF") +
    [
      columns.map((key) => escape(options.headers?.[key] ?? key)).join(","),
      ...rows.map((row) => columns.map((key) => escape(row[key])).join(",")),
    ].join("\r\n")
  );
}
export function downloadWindChimeCsv(
  rows: WindChimeMessageRecord[],
  filename: string,
  options?: Parameters<typeof windChimeMessagesToCsv>[1],
): void {
  const url = URL.createObjectURL(
    new Blob([windChimeMessagesToCsv(rows, options)], {
      type: "text/csv;charset=utf-8",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
