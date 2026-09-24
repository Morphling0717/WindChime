"use client";
import { useId, useState } from "react";

export function WindChimeAttachmentInput({ files, onChange, disabled }: {
  files: File[]; onChange: (files: File[]) => void; disabled?: boolean;
}) {
  const id = useId();
  const [error, setError] = useState("");
  return <fieldset disabled={disabled} style={{ border: "1px solid currentColor", borderRadius: 12, padding: 12, margin: "12px 0" }}>
    <legend>附上图片（可选）</legend>
    <label htmlFor={id}>静态 JPEG、PNG 或 WebP，最多 3 张，每张 5 MiB</label>
    <input id={id} type="file" accept="image/jpeg,image/png,image/webp" multiple aria-describedby={`${id}-error`}
      style={{ display: "block", marginTop: 8, width: "100%" }}
      onChange={event => {
        const selected = Array.from(event.target.files ?? []);
        if (selected.length > 3 || selected.some(file => file.size > 5 * 1024 * 1024 || !["image/jpeg", "image/png", "image/webp"].includes(file.type))) {
          setError("请选择最多 3 张静态图片，每张不超过 5 MiB。"); event.target.value = ""; return;
        }
        setError(""); onChange(selected); event.target.value = "";
      }} />
    {files.length > 0 && <ul>{files.map((file, index) => <li key={`${file.name}-${index}`}>
      {file.name} <button type="button" onClick={() => onChange(files.filter((_, i) => i !== index))}>移除</button>
    </li>)}</ul>}
    <small>图片随信件私下交给主播，审核通过并手动上屏后才会展示。</small>
    <p id={`${id}-error`} role={error ? "alert" : undefined}>{error}</p>
  </fieldset>;
}
