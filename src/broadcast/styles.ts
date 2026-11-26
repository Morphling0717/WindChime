export const windChimeControlCss = `
.wc-live{--wc-bg:#111a24;--wc-panel:#192531;--wc-border:#32414e;--wc-ink:#eaf1f6;--wc-muted:#a5b6c5;--wc-accent:#8fe1d5;color:var(--wc-ink);background:var(--wc-bg);font:14px/1.5 system-ui,sans-serif;padding:24px;border-radius:18px;box-sizing:border-box;color-scheme:dark;min-height:650px}.wc-live *{box-sizing:border-box}.wc-live button,.wc-live input,.wc-live select,.wc-live textarea{font:inherit}.wc-live button{cursor:pointer;border:1px solid var(--wc-border);background:#253440;color:var(--wc-ink);border-radius:8px;padding:8px 12px;line-height:1.35}.wc-live button:hover{background:#344754}.wc-live button:disabled{cursor:not-allowed;opacity:.4}.wc-live button:focus-visible,.wc-live input:focus-visible,.wc-live textarea:focus-visible,.wc-live select:focus-visible{outline:2px solid var(--wc-accent);outline-offset:3px}.wc-live button.wc-primary{background:var(--wc-accent);color:#102e2c;border-color:var(--wc-accent);font-weight:700}.wc-live button.wc-danger{background:#d5635e;border-color:#ed918b;color:#fff;font-weight:700}.wc-live button.wc-subtle{background:transparent}.wc-live input,.wc-live select,.wc-live textarea{width:100%;background:#101923;color:var(--wc-ink);border:1px solid var(--wc-border);padding:9px 11px;border-radius:7px}.wc-live textarea{resize:vertical;min-height:130px}.wc-live label{display:block;color:var(--wc-muted);font-size:12px}.wc-live label>input,.wc-live label>select,.wc-live label>textarea{margin-top:5px}.wc-live h2,.wc-live h3,.wc-live p{margin:0}.wc-live h2{font-size:24px;letter-spacing:.03em}.wc-live h3{font-size:15px}.wc-live .wc-top{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:20px}.wc-live .wc-eyebrow{font-size:10px;letter-spacing:.2em;color:var(--wc-accent);margin-bottom:6px}.wc-live .wc-muted{color:var(--wc-muted);font-size:12px}.wc-live .wc-actions{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.wc-live .wc-status{display:flex;gap:16px;align-items:center;padding:12px 16px;background:#1d3037;border:1px solid #395a5c;border-radius:10px;margin-bottom:16px}.wc-live .wc-led{width:8px;height:8px;display:inline-block;border-radius:50%;background:#eeb36c;margin-right:7px}.wc-live .wc-led.on{background:var(--wc-accent)}.wc-live .wc-columns{display:grid;grid-template-columns:minmax(190px,.8fr) minmax(300px,1.6fr) minmax(240px,1fr);gap:16px}.wc-live .wc-panel{background:var(--wc-panel);border:1px solid var(--wc-border);border-radius:12px;overflow:hidden;min-width:0}.wc-live .wc-panel-head{padding:16px;border-bottom:1px solid var(--wc-border);display:flex;justify-content:space-between;align-items:center;gap:10px}.wc-live .wc-pad{padding:16px}.wc-live .wc-stack{display:grid;gap:13px}.wc-live .wc-mail-list{max-height:650px;overflow:auto;padding:8px}.wc-live .wc-mail{display:block;text-align:left;width:100%;margin-bottom:5px;padding:12px;background:transparent;border:1px solid transparent}.wc-live .wc-mail[aria-current=true]{background:#283d48;border-color:#77bfb9}.wc-live .wc-mail-title{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}.wc-live .wc-snippet{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px;color:var(--wc-muted);white-space:pre-wrap;overflow-wrap:anywhere}.wc-live .wc-tag{font-size:10px;white-space:nowrap;padding:1px 6px;border:1px solid #48616e;border-radius:4px;align-self:flex-start;color:#b8d3df}.wc-live .wc-tag.approved{color:#a6e7ca;border-color:#43735b}.wc-live .wc-tag.rejected{color:#e2a29e}.wc-live .wc-tabs{display:flex;gap:4px;flex-wrap:wrap;padding:12px}.wc-live .wc-tabs button{font-size:11px;padding:5px 8px}.wc-live .wc-tabs button[aria-pressed=true]{border-color:var(--wc-accent);color:var(--wc-accent)}.wc-live .wc-source{padding:12px;background:#101923;border:1px dashed #45515d;border-radius:7px;max-height:250px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}.wc-live .wc-rule{height:1px;background:var(--wc-border);margin:3px 0}.wc-live .wc-error{background:#46292d;color:#ffd0ca;border:1px solid #a36564;border-radius:8px;padding:12px;margin-bottom:16px;overflow-wrap:anywhere}.wc-live .wc-queue{list-style:none;padding:0;margin:0}.wc-live .wc-queue li{padding:12px 16px;border-bottom:1px solid var(--wc-border)}.wc-live .wc-queue li[aria-current=true]{background:#264c45}.wc-live .wc-preview{background-color:#65717b;background-image:linear-gradient(45deg,#59656f 25%,transparent 25%),linear-gradient(-45deg,#59656f 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#59656f 75%),linear-gradient(-45deg,transparent 75%,#59656f 75%);background-size:24px 24px;background-position:0 0,0 12px,12px -12px,-12px 0;min-height:150px;border-radius:8px;overflow:hidden;margin:10px 0;padding:8px}.wc-live .wc-preview article{font-size:18px!important;max-height:300px;overflow:auto}.wc-live .wc-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}.wc-live details>summary{cursor:pointer;color:var(--wc-muted);font-size:12px;padding:10px 0}.wc-live .wc-settings{margin-top:16px}.wc-live .wc-empty{padding:32px 18px;text-align:center;color:var(--wc-muted)}.wc-live .wc-asset{display:flex;align-items:flex-start;gap:10px}.wc-live .wc-asset img{width:90px;max-height:100px;object-fit:contain;background:#111}.wc-live .wc-asset>label{flex:1}.wc-live .wc-checkbox{display:flex;align-items:center;gap:8px}.wc-live .wc-checkbox input{width:auto;margin:0}.wc-live .wc-grant-url{font-size:11px;word-break:break-all}.wc-live .wc-notice{color:#b8e8cf;background:#203b32;border-radius:7px;padding:10px;overflow-wrap:anywhere}.wc-live .wc-queue-small{font-size:11px!important;padding:4px 7px!important}@media(max-width:1120px){.wc-live .wc-columns{grid-template-columns:minmax(180px,.7fr) minmax(300px,1.5fr)}.wc-live .wc-queue-panel{grid-column:1/-1}}@media(max-width:690px){.wc-live{padding:12px}.wc-live .wc-columns{display:block}.wc-live .wc-panel{margin-bottom:12px}.wc-live .wc-mail-list{max-height:220px}.wc-live .wc-grid2{grid-template-columns:1fr}.wc-live .wc-top h2{font-size:20px}}

.wc-live .wc-tile-launcher{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0 18px}
.wc-live .wc-tile-launcher>.wc-actions{margin-left:auto}
.wc-live[data-module]{min-height:0;padding:12px;border-radius:0}
.wc-live[data-module] .wc-columns,.wc-live[data-module] .wc-grid2{display:block}
.wc-live[data-module] .wc-status{gap:8px;flex-wrap:wrap;padding:10px;font-size:11px}
.wc-live[data-module] .wc-status strong{flex-basis:100%;margin-left:0!important}
.wc-live[data-module] .wc-mail-list{max-height:none}
.wc-live[data-module] .wc-settings{margin-top:0}
.wc-live .wc-preview article{max-height:none;overflow:hidden}
.wc-live .wc-teleprompter{margin-bottom:14px}
.wc-live .wc-teleprompter-head{flex-wrap:wrap;gap:8px;padding:10px 14px}
.wc-live .wc-teleprompter-title{display:flex;align-items:center;gap:8px;min-width:0}
.wc-live .wc-teleprompter-title strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wc-live .wc-teleprompter-meta{display:flex;align-items:center;gap:8px;margin-left:auto}
.wc-live .wc-teleprompter-size{display:flex;gap:4px}
.wc-live .wc-teleprompter-text{max-height:210px;overflow-y:auto;padding:14px 16px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;background:rgba(16,25,35,.55);border-bottom:1px solid var(--wc-border);overscroll-behavior:contain}
.wc-live .wc-teleprompter.is-compact .wc-teleprompter-text{max-height:240px;padding:10px 12px}
.wc-live .wc-teleprompter-extra{margin-top:10px;font-size:.82em;color:var(--wc-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.wc-live .wc-teleprompter-controls{padding:10px 14px;display:grid;gap:8px}
.wc-live .wc-teleprompter.is-compact .wc-teleprompter-controls{padding:8px 10px;gap:6px}
.wc-live .wc-teleprompter-slider{display:flex;align-items:center;gap:8px;margin:0}
.wc-live .wc-teleprompter-slider input[type=range]{flex:1;margin:0;padding:0;height:6px;accent-color:var(--wc-accent);background:transparent;border:0}
.wc-live .wc-teleprompter-pct{font-size:11px;color:var(--wc-muted);min-width:34px;text-align:right;font-variant-numeric:tabular-nums}
.wc-live .wc-teleprompter-empty{padding:12px 14px;font-size:12px;color:var(--wc-muted);line-height:1.6}
.wc-live .wc-teleprompter-media{display:flex;gap:8px;padding:8px 14px;border-bottom:1px solid var(--wc-border);overflow-x:auto;background:rgba(16,25,35,.32)}
.wc-live .wc-teleprompter.is-compact .wc-teleprompter-media{padding:6px 10px}
.wc-live .wc-teleprompter-thumb{width:56px;height:56px;padding:2px;flex:none;display:grid;place-items:center;border-radius:8px;overflow:hidden;background:#101923}
.wc-live .wc-teleprompter-thumb img{width:100%;height:100%;object-fit:cover;border-radius:6px;display:block}
.wc-live .wc-teleprompter-lightbox{position:fixed;inset:0;z-index:999;background:rgba(9,14,20,.82);backdrop-filter:blur(8px);display:grid;place-items:center;padding:24px}
.wc-live .wc-teleprompter-lightbox-card{max-width:min(92vw,960px);max-height:90vh;display:grid;gap:12px;background:#16222e;border:1px solid #395063;border-radius:14px;padding:14px;box-shadow:0 24px 64px rgba(0,0,0,.5)}
.wc-live .wc-teleprompter-lightbox-card img{max-width:100%;max-height:calc(90vh - 96px);object-fit:contain;border-radius:8px;display:block;margin:0 auto}
.wc-live .wc-teleprompter-lightbox-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;color:#dbe8f0;font-size:12px}
.wc-live .wc-panel.wc-review-panel{overflow:clip}
.wc-live .wc-review-sticky-bar{position:sticky;bottom:0;z-index:4;margin:4px -16px -16px;padding:12px 16px;background:rgba(25,37,49,.95);border-top:1px solid var(--wc-border);backdrop-filter:blur(14px);display:grid;gap:8px;border-radius:0 0 12px 12px}
.wc-live .wc-mail-search{padding:0 12px 8px}
.wc-live .wc-mail-search input{padding:7px 10px;font-size:12px}
.wc-live .wc-tab-count{margin-left:3px;opacity:.7;font-variant-numeric:tabular-nums}
.wc-live .wc-mail-badges{display:flex;align-items:center;gap:4px;flex-shrink:0}
.wc-live .wc-img-badge{color:#a8d4e6;border-color:#446b7d}
.wc-live .wc-display-guide{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:10px;background:rgba(143,225,213,.1);border:1px solid rgba(143,225,213,.38);font-size:12px;color:var(--wc-ink)}
.wc-live .wc-queue li[data-played=true]:not([aria-current=true]){opacity:.72}
.wc-live .wc-tag-played{color:#9ab0bc;border-color:#49606d}
.wc-live .wc-inline-toggle{font-size:11px;color:var(--wc-muted);cursor:pointer;user-select:none}
.wc-live .wc-studio-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.wc-live .wc-mode-switch{display:inline-flex;gap:4px;padding:4px;border-radius:12px;background:rgba(16,25,35,.45);border:1px solid var(--wc-border)}
.wc-live .wc-mode-switch button{border:1px solid transparent;background:transparent;padding:7px 14px;border-radius:9px;font-size:12px;font-weight:500}
.wc-live .wc-mode-switch button[aria-pressed=true]{background:var(--wc-accent);color:#102e2c;font-weight:700}
.wc-live .wc-tile-compact{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wc-live .wc-tile-more{position:relative}
.wc-live .wc-tile-more>summary{list-style:none;padding:7px 12px;border:1px solid var(--wc-border);border-radius:8px;background:#253440;color:var(--wc-ink);font-size:12px;user-select:none}
.wc-live .wc-tile-more>summary::-webkit-details-marker{display:none}
.wc-live .wc-tile-more-menu{position:absolute;right:0;top:calc(100% + 6px);z-index:25;min-width:168px;padding:6px;display:grid;gap:4px;background:var(--wc-panel);border:1px solid var(--wc-border);border-radius:12px;box-shadow:0 14px 36px rgba(0,0,0,.35)}
.wc-live .wc-tile-more-menu button{text-align:left;width:100%}
.wc-live .wc-bb-studio{display:grid;gap:14px}
.wc-live .wc-bb-topbar{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;padding:12px 16px}
.wc-live .wc-bb-counters{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.wc-live .wc-bb-pill{font-size:12px;padding:4px 10px;border-radius:999px;background:rgba(143,225,213,.1);border:1px solid var(--wc-border);color:var(--wc-muted)}
.wc-live .wc-bb-pill.is-pending{color:var(--wc-accent);border-color:rgba(143,225,213,.45);font-weight:600}
.wc-live .wc-bb-standby{padding:36px 24px}
.wc-live .wc-bb-standby-inner{max-width:560px;margin:0 auto;display:grid;justify-items:center;text-align:center;gap:14px}
.wc-live .wc-bb-badge-count{width:64px;height:64px;border-radius:20px;display:grid;place-items:center;font-size:28px;font-weight:700;background:rgba(143,225,213,.14);border:1px solid rgba(143,225,213,.4);color:var(--wc-accent);font-variant-numeric:tabular-nums}
.wc-live .wc-bb-standby-actions{justify-content:center;margin-top:4px}
.wc-live .wc-bb-draw-btn{padding:11px 22px;font-size:15px}
.wc-live .wc-bb-private-banner{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;padding:10px 16px;background:rgba(238,179,108,.14);border-bottom:1px solid rgba(238,179,108,.35);color:#f7d5a8;font-size:12px}
.wc-live .wc-bb-letter-head{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:10px}
.wc-live .wc-bb-reading{padding:16px 18px;border-radius:12px;background:#101923;border:1px solid var(--wc-border)}
.wc-live .wc-bb-reading-text{font-size:16px;line-height:1.85;white-space:pre-wrap;overflow-wrap:anywhere;max-height:320px;overflow-y:auto}
.wc-live .wc-bb-link-chip{margin-top:12px;padding:8px 10px;border-radius:8px;background:rgba(143,225,213,.08);border:1px dashed var(--wc-border);font-size:12px;color:var(--wc-muted);overflow-wrap:anywhere}
.wc-live .wc-bb-assets{display:grid;gap:10px}
.wc-live .wc-bb-assets-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px}
.wc-live .wc-bb-asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.wc-live .wc-bb-asset-card{display:grid;gap:8px;padding:10px;border-radius:10px;border:1px solid var(--wc-border);background:rgba(16,25,35,.45)}
.wc-live .wc-bb-asset-frame{position:relative;height:148px;border-radius:8px;overflow:hidden;background:#0c131b;display:grid;place-items:center}
.wc-live .wc-bb-asset-frame img{width:100%;height:100%;object-fit:contain;transition:filter .2s}
.wc-live .wc-bb-asset-frame img.is-blurred{filter:blur(22px) scale(1.08)}
.wc-live .wc-bb-reveal-btn{position:absolute;z-index:2;padding:7px 12px;border-radius:999px;font-size:12px;font-weight:600;background:rgba(16,25,35,.86);color:#fff;border:1px solid rgba(255,255,255,.35)}
.wc-live .wc-bb-decision-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-top:8px;border-top:1px solid var(--wc-border)}
.wc-live .wc-bb-go-live{padding:11px 20px;font-size:14px}
.wc-live .wc-bb-live-stage{display:grid;gap:12px}
.wc-live .wc-bb-stage-bar{padding:12px 16px}
.wc-live .wc-bb-history>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 16px;font-size:13px;font-weight:600;color:var(--wc-ink)}
.wc-live .wc-bb-meta-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:4px;font-size:11px;color:var(--wc-muted)}
.wc-live .wc-bb-stat-pill{padding:2px 8px;border-radius:999px;background:rgba(143,225,213,.1);border:1px solid var(--wc-border);font-variant-numeric:tabular-nums}
.wc-live .wc-bb-studio.is-compact .wc-bb-topbar{padding:8px 12px}
.wc-live .wc-bb-studio.is-compact .wc-bb-standby{padding:20px 14px}
.wc-live .wc-bb-studio.is-compact .wc-bb-badge-count{width:48px;height:48px;font-size:22px;border-radius:14px}
.wc-live .wc-bb-studio.is-compact .wc-bb-reading{padding:12px}
.wc-live .wc-bb-studio.is-compact .wc-bb-reading-text{font-size:14px;max-height:200px}
.wc-live .wc-bb-studio.is-compact .wc-bb-asset-grid{grid-template-columns:1fr}
.wc-live .wc-bb-studio.is-compact .wc-bb-asset-frame{height:120px}
.wc-live .wc-bb-history-log{display:grid;gap:8px;max-height:260px;overflow-y:auto;padding:0;margin:0;list-style:none}
.wc-live .wc-bb-history-row{padding:8px 10px;border-radius:10px;border:1px solid var(--wc-border);background:rgba(16,25,35,.32);display:grid;gap:4px;font-size:12px}
.wc-live .wc-bb-history-row-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
`;
