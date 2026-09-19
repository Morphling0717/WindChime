export const windChimeAppearanceEditorCss = `
.wc-live .wc-appearance-editor{display:grid;gap:20px;min-width:0;margin:0;color:var(--wc-ink)}
.wc-live .wc-appearance-caption{font-size:11px;line-height:1.55;color:var(--wc-muted)}
.wc-live .wc-appearance-preview{overflow:hidden;border:1px solid var(--wc-border);border-radius:12px;background:color-mix(in srgb,var(--wc-panel) 75%,transparent)}
.wc-live .wc-appearance-preview-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:11px 13px}
.wc-live .wc-appearance-preview-head>strong{font-size:12px;font-weight:600}
.wc-live .wc-appearance-viewport{position:relative;width:100%;overflow:hidden;background-color:#343d48;background-image:linear-gradient(45deg,#3b4552 25%,transparent 25%),linear-gradient(-45deg,#3b4552 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#3b4552 75%),linear-gradient(-45deg,transparent 75%,#3b4552 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}
.wc-live .wc-appearance-viewport-light{background-color:#e1e8eb;background-image:linear-gradient(45deg,#f2f5f6 25%,transparent 25%),linear-gradient(-45deg,#f2f5f6 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f2f5f6 75%),linear-gradient(-45deg,transparent 75%,#f2f5f6 75%)}
.wc-live .wc-appearance-scroll-space{position:relative;width:100%;overflow:hidden}
.wc-live .wc-appearance-canvas{position:absolute;left:0;top:0;padding:40px;display:flex;align-items:center;justify-content:center;transform-origin:top left}
.wc-live .wc-appearance-preview-content{width:100%;min-width:0;flex:0 0 auto}
.wc-live .wc-appearance-viewport:focus-visible{outline:2px solid var(--wc-accent);outline-offset:-2px}
.wc-live .wc-appearance-preview-options{padding:10px 12px;display:flex;align-items:center;flex-wrap:wrap;gap:9px 12px}
.wc-live .wc-appearance-preview-options>.wc-appearance-caption{margin-left:auto}
.wc-live .wc-appearance-check{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--wc-muted);font-size:11px}
.wc-live .wc-appearance-check>input{flex:0 0 auto;width:14px;height:14px;padding:0;margin:0;accent-color:var(--wc-accent)}
.wc-live .wc-appearance-canvas-options{display:flex;border:1px solid var(--wc-border);border-radius:6px;padding:2px;gap:2px}
.wc-live .wc-appearance-canvas-options>button{padding:3px 6px;font-size:10px;border:0;border-radius:4px;background:transparent;color:var(--wc-muted);box-shadow:none}
.wc-live .wc-appearance-canvas-options>button[aria-pressed=true]{background:color-mix(in srgb,var(--wc-accent) 15%,transparent);color:var(--wc-ink)}
.wc-live .wc-appearance-section{border:0;padding:0;margin:0;min-width:0;display:grid;gap:12px}
.wc-live .wc-appearance-section>legend{float:left;width:100%;padding:0;margin:0 0 9px;font-size:13px;font-weight:650;color:var(--wc-ink)}
.wc-live .wc-appearance-section-note{font-size:11px;line-height:1.55;color:var(--wc-muted);margin:-4px 0 1px}
.wc-live .wc-appearance-choices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;min-width:0}
.wc-live .wc-appearance-choice{position:relative;min-width:0;text-align:left;padding:7px;display:flex;flex-direction:column;align-items:stretch;gap:7px;color:var(--wc-ink);border:1px solid var(--wc-border);border-radius:10px;background:color-mix(in srgb,var(--wc-panel) 72%,transparent);box-shadow:none;transition:border-color .15s,background .15s}
.wc-live .wc-appearance-choice:hover{background:color-mix(in srgb,var(--wc-accent) 7%,var(--wc-panel));border-color:color-mix(in srgb,var(--wc-accent) 60%,var(--wc-border))}
.wc-live .wc-appearance-choice[aria-pressed=true]{border-color:var(--wc-accent);background:color-mix(in srgb,var(--wc-accent) 9%,var(--wc-panel));box-shadow:0 0 0 1px color-mix(in srgb,var(--wc-accent) 28%,transparent)}
.wc-live .wc-appearance-theme-sample{height:78px;display:flex;flex-direction:column;justify-content:center;gap:5px;border-radius:5px;padding:10px;overflow:hidden}
.wc-live .wc-appearance-theme-pure{color:#f1f5f8;background:linear-gradient(140deg,#42505e,#2d3742)}
.wc-live .wc-appearance-theme-uliuli{color:#fff;background:radial-gradient(ellipse at 100% 0,#10434c,#050508 75%);border-top:2px solid #2de2e6;border-bottom:1px solid #2de2e666;border-radius:2px;font-family:'Segoe UI','Microsoft YaHei',sans-serif}
.wc-live .wc-appearance-theme-mia{color:#2b2620;background:linear-gradient(120deg,#fffdf6,#f3ead9);border:1px solid #c4a96e88;font-family:'Noto Serif SC','Songti SC',SimSun,serif}
.wc-live .wc-appearance-sample-eyebrow{font-size:8px;letter-spacing:.08em;opacity:.65;white-space:nowrap}
.wc-live .wc-appearance-theme-uliuli .wc-appearance-sample-eyebrow{color:#2de2e6;opacity:1;letter-spacing:.16em}
.wc-live .wc-appearance-sample-text{font-size:16px;letter-spacing:.07em;line-height:1.3;white-space:nowrap}
.wc-live .wc-appearance-sample-line{display:block;width:57%;height:2px;background:currentColor;opacity:.22}
.wc-live .wc-appearance-theme-pure .wc-appearance-sample-line{visibility:hidden}
.wc-live .wc-appearance-theme-mia .wc-appearance-sample-line{background:#c4a96e;opacity:.7}
.wc-live .wc-appearance-choice-name{display:flex;align-items:center;justify-content:space-between;gap:4px;font-size:12px;font-weight:650;line-height:1.5;padding:0 2px}
.wc-live .wc-appearance-selected{color:var(--wc-accent);width:13px;text-align:center;font-size:12px}
.wc-live .wc-appearance-choice-note{font-size:10px;font-weight:400;line-height:1.55;color:var(--wc-muted);padding:0 2px 2px}
.wc-live .wc-appearance-layout-sample{height:56px;border-radius:5px;background:color-mix(in srgb,var(--wc-ink) 4%,transparent);padding:10px 16px;display:flex;gap:6px;color:var(--wc-muted)}
.wc-live .wc-appearance-layout-copy{display:flex;flex-direction:column;justify-content:center;gap:4px;flex:1;min-width:0}
.wc-live .wc-appearance-layout-copy>i{display:block;height:3px;border-radius:2px;background:currentColor;opacity:.5}
.wc-live .wc-appearance-layout-copy>i:last-child{width:65%}
.wc-live .wc-appearance-layout-image{display:block;min-width:0;border:1px solid currentColor;border-radius:2px;background:color-mix(in srgb,var(--wc-accent) 18%,transparent);opacity:.55}
.wc-live .wc-appearance-layout-stack{flex-direction:column;padding:9px 22px}
.wc-live .wc-appearance-layout-stack .wc-appearance-layout-copy{gap:3px}
.wc-live .wc-appearance-layout-stack .wc-appearance-layout-copy>i{height:2px}
.wc-live .wc-appearance-layout-stack .wc-appearance-layout-image{height:13px}
.wc-live .wc-appearance-layout-split .wc-appearance-layout-image{width:37%}
.wc-live .wc-appearance-layout-banner{align-items:center;padding:10px}
.wc-live .wc-appearance-layout-banner .wc-appearance-layout-copy{border-left:2px solid var(--wc-accent);padding-left:6px}
.wc-live .wc-appearance-layout-banner .wc-appearance-layout-image{width:26%;height:22px}
.wc-live .wc-appearance-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.wc-live .wc-appearance-type-fields{grid-template-columns:minmax(0,1.8fr) minmax(80px,1fr)}
.wc-live .wc-appearance-colors{grid-template-columns:repeat(3,minmax(0,1fr))}
.wc-live .wc-appearance-field{display:flex;flex-direction:column;gap:6px;min-width:0;font-size:11px;color:var(--wc-muted)}
.wc-live .wc-appearance-field>select,.wc-live .wc-appearance-number>input{font-size:12px;min-width:0;height:38px;padding:8px 10px;margin:0;border-radius:7px;background:color-mix(in srgb,var(--wc-bg) 48%,var(--wc-panel));border-color:var(--wc-border);color:var(--wc-ink)}
.wc-live .wc-appearance-number{position:relative;display:block}
.wc-live .wc-appearance-number>input{padding-right:40px;width:100%}
.wc-live .wc-appearance-unit{position:absolute;right:26px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--wc-muted);pointer-events:none}
.wc-live .wc-appearance-color{display:flex;align-items:center;gap:7px;border:1px solid var(--wc-border);border-radius:7px;min-height:38px;padding:6px;background:color-mix(in srgb,var(--wc-bg) 48%,var(--wc-panel))}
.wc-live .wc-appearance-color>input{flex:0 0 24px;display:block;width:24px;min-width:24px;height:24px;padding:0;margin:0;border:0;border-radius:4px;background:none;cursor:pointer;box-shadow:none}
.wc-live .wc-appearance-color>input::-webkit-color-swatch-wrapper{padding:0}
.wc-live .wc-appearance-color>input::-webkit-color-swatch{border:1px solid color-mix(in srgb,var(--wc-muted) 40%,transparent);border-radius:4px}
.wc-live .wc-appearance-color-value{font-size:10px;letter-spacing:.01em;color:var(--wc-muted);overflow:hidden;text-overflow:ellipsis}
.wc-live .wc-appearance-transparency{border-radius:8px;padding:10px 11px;background:color-mix(in srgb,var(--wc-accent) 6%,transparent)}
.wc-live .wc-appearance-transparency>span{display:flex;align-items:center;flex-wrap:wrap;gap:3px 10px}
.wc-live .wc-appearance-transparency strong{font-size:12px;font-weight:500;color:var(--wc-ink)}
.wc-live .wc-appearance-advanced{border-top:1px solid var(--wc-border);border-bottom:1px solid var(--wc-border)}
.wc-live .wc-appearance-advanced>summary{padding:13px 0;color:var(--wc-ink);font-size:12px;list-style-position:inside}
.wc-live .wc-appearance-advanced>summary>.wc-appearance-caption{margin-left:10px}
.wc-live .wc-appearance-advanced-content{display:grid;gap:20px;padding:8px 0 18px}
.wc-live .wc-appearance-save{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.wc-live .wc-appearance-save-state{display:flex;align-items:center;gap:7px;font-size:11px;color:var(--wc-muted)}
.wc-live .wc-appearance-save-state>i{width:6px;height:6px;border-radius:50%;background:var(--wc-accent)}
.wc-live .wc-appearance-save-state>.wc-appearance-dirty{background:#d8a454}
.wc-live .wc-appearance-apply{background:var(--wc-accent);border-color:var(--wc-accent);color:var(--wc-bg);font-size:12px;font-weight:650;padding:9px 20px;border-radius:8px}
.wc-live .wc-appearance-apply:hover{background:var(--wc-accent);filter:brightness(1.08)}
.wc-live .wc-appearance-conflict{padding:12px;border:1px solid #a96b4f88;border-radius:8px;background:color-mix(in srgb,#d8a454 12%,var(--wc-panel));font-size:12px;color:var(--wc-ink)}
.wc-live .wc-appearance-conflict-actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}
.wc-live .wc-appearance-conflict-actions>button{font-size:11px}
.wc-live .wc-appearance-upgrade{padding:10px 12px;border:1px solid var(--wc-border);border-radius:8px;background:color-mix(in srgb,var(--wc-accent) 8%,var(--wc-panel));font-size:12px;line-height:1.7;color:var(--wc-ink)}
@media(max-width:480px){.wc-live .wc-appearance-choices{gap:6px}.wc-live .wc-appearance-choice{padding:5px}.wc-live .wc-appearance-theme-sample{padding:7px;height:68px}.wc-live .wc-appearance-choice-note{font-size:9px}.wc-live .wc-appearance-color-value{font-size:9px}.wc-live .wc-appearance-color{gap:4px;padding:5px}.wc-live .wc-appearance-color>input{flex-basis:20px;min-width:20px;width:20px;height:22px}.wc-live .wc-appearance-advanced>summary>.wc-appearance-caption{margin-left:4px;font-size:10px}}
@media(prefers-reduced-motion:reduce){.wc-live .wc-appearance-choice{transition:none}}
`;
