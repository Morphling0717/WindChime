/** Output-only styles: no requests, site background, controls or cached assets. */
export const windChimeDisplayCss = `
.wc-display{display:flex;flex-direction:column;overflow:hidden;position:relative;isolation:isolate;box-sizing:border-box;container-type:inline-size;overflow-wrap:anywhere;min-width:0;max-width:100%;margin:0 auto;line-height:var(--wc-display-leading);color:var(--wc-display-ink);font-family:var(--wc-display-font);font-size:var(--wc-display-size);letter-spacing:var(--wc-display-tracking);padding:var(--wc-display-padding);border:var(--wc-display-border) solid var(--wc-display-accent);border-radius:var(--wc-display-radius);background:var(--wc-display-fill);}
.wc-display *{box-sizing:border-box}
.wc-display .wc-display-body{position:relative;z-index:1;display:flex;flex-direction:column;flex:1 1 0;min-height:0;min-width:0;gap:min(.7em,12px,5%)}
.wc-display .wc-display-viewport{position:relative;z-index:1;min-height:0;flex:1 1 auto;overflow:hidden;scroll-behavior:auto;overflow-anchor:none}
.wc-display .wc-display-grid{position:relative;z-index:1;display:grid;gap:.7em;min-width:0}
.wc-display .wc-display-author{font-size:.58em;letter-spacing:.06em;line-height:1.5;min-width:0;white-space:pre-wrap;opacity:.85}
.wc-display .wc-display-copy{min-width:0}
.wc-display .wc-display-text{white-space:pre-wrap;overflow-wrap:anywhere}
.wc-display .wc-display-link{font-size:.5em;line-height:1.6;opacity:.75;margin-top:1.25em;white-space:pre-wrap;overflow-wrap:anywhere}
.wc-display .wc-display-image-captions{grid-column:1/-1;font-size:.5em;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere}
.wc-display .wc-display-image-captions p{margin:0 0 .65em}
.wc-display .wc-display-caption-label{opacity:.65}
.wc-display .wc-display-media{display:grid;flex:0 0 min(var(--wc-display-media-height),max(10%,calc(100% - min(60%,calc(var(--wc-display-size) * var(--wc-display-leading))) - min(.7em,12px,5%))));grid-template-columns:minmax(0,1fr);grid-template-rows:repeat(var(--wc-display-image-count),minmax(0,1fr));gap:min(.35em,8px,5%);min-height:0;min-width:0}
.wc-display .wc-display-media[data-arrangement="row"]{grid-template-columns:repeat(var(--wc-display-image-count),minmax(0,1fr));grid-template-rows:minmax(0,1fr)}
.wc-display .wc-display-media[data-arrangement="grid"]{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:minmax(0,1fr)}
.wc-display .wc-display-media[data-arrangement="grid"][data-count="3"]{grid-template-rows:repeat(2,minmax(0,1fr))}
.wc-display .wc-display-media[data-arrangement="grid"][data-count="3"] figure:last-child{grid-column:1/-1}
.wc-display .wc-display-media[data-count="1"]{grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(0,1fr)}
.wc-display .wc-display-media figure{position:relative;display:grid;place-items:center;container-type:size;margin:0;min-height:0;min-width:0;max-width:100%}
.wc-display .wc-display-media img{display:block;min-width:0;min-height:0;max-width:100%;max-height:100%;width:min(100cqw,calc(100cqh * var(--wc-display-image-ratio)));height:auto;object-fit:contain;border-radius:min(var(--wc-display-radius),12px)}
.wc-display .wc-display-image-number{position:absolute;bottom:4px;right:4px;display:grid;place-items:center;min-width:1.6em;height:1.6em;padding:0 .3em;border-radius:50%;font:500 12px/1 system-ui;color:#fff;background:#0009;letter-spacing:0}
.wc-display .wc-display-ornament{position:absolute;pointer-events:none;z-index:0;color:var(--wc-display-accent)}
.wc-display[data-theme="uliuli"]{box-shadow:inset 0 0 36px color-mix(in srgb,var(--wc-display-accent) 5%,transparent),0 8px 30px #00000020}
.wc-display[data-theme="uliuli"] .wc-display-author{color:var(--wc-display-accent);font-family:"Segoe UI","Microsoft YaHei",sans-serif;letter-spacing:.1em}
.wc-display[data-theme="uliuli"] .wc-display-corner{width:20px;height:20px;border-color:var(--wc-display-accent);border-style:solid;border-width:0;opacity:.85}
.wc-display[data-theme="uliuli"] .wc-display-corner-a{left:10px;top:10px;border-left-width:2px;border-top-width:2px}
.wc-display[data-theme="uliuli"] .wc-display-corner-b{right:10px;bottom:10px;border-right-width:2px;border-bottom-width:2px}
.wc-display[data-theme="uliuli"] .wc-display-orbit{width:140px;height:140px;right:18px;top:12px;opacity:.12}
.wc-display[data-theme="uliuli"][data-filled="true"]{background-image:radial-gradient(ellipse at 100% 0,color-mix(in srgb,var(--wc-display-accent) 10%,transparent),transparent 55%)}
.wc-display[data-theme="mia"]{box-shadow:0 12px 32px #614c2920,inset 0 0 38px color-mix(in srgb,var(--wc-display-accent) 6%,transparent)}
.wc-display[data-theme="mia"] .wc-display-author{font-weight:600;letter-spacing:.08em}
.wc-display[data-theme="mia"] .wc-display-inner-frame{inset:8px;border:1px solid currentColor;border-radius:max(0px,calc(var(--wc-display-radius) - 6px));opacity:.4}
.wc-display[data-theme="mia"] .wc-display-arch{right:20px;top:16px;width:90px;height:122px;opacity:.14}
.wc-display[data-theme="mia"] .wc-display-star{width:14px;height:14px;bottom:17px;left:17px;opacity:.7}
.wc-display[data-theme="mia"][data-filled="true"]{background-image:radial-gradient(ellipse at 90% 0,color-mix(in srgb,var(--wc-display-accent) 11%,transparent),transparent 65%)}
.wc-display[data-layout="split"] .wc-display-author{grid-column:1/-1}
.wc-display[data-layout="split"] .wc-display-text{column-count:2;column-gap:1.5em}
.wc-display[data-layout="banner"] .wc-display-grid{grid-template-columns:minmax(80px,.23fr) minmax(0,1fr);gap:.7em 1em;align-items:start}
.wc-display[data-layout="banner"] .wc-display-author{grid-column:1;grid-row:1;margin-top:.15em}
.wc-display[data-layout="banner"] .wc-display-copy{grid-column:2;grid-row:1}
.wc-display[data-layout="banner"][data-has-author="false"] .wc-display-copy{grid-column:1/-1}
.wc-display[data-layout="sidebar"] .wc-display-grid{gap:.4em}
.wc-display[data-layout="sidebar"] .wc-display-author{font-size:.65em;font-weight:600;letter-spacing:0}
.wc-display[data-layout="sidebar"] .wc-display-copy{text-align:start}
.wc-display[data-layout="portrait"] .wc-display-grid{gap:1.1em;max-width:24em;margin-inline:auto}
.wc-display[data-layout="portrait"] .wc-display-author{text-align:center;letter-spacing:.15em}
.wc-display[data-layout="portrait"] .wc-display-text{text-indent:2em}
.wc-display[data-layout="focus"] .wc-display-grid{min-height:100%;align-content:center;text-align:center;gap:1em}
.wc-display[data-layout="focus"] .wc-display-copy{order:0;max-width:22ch;margin-inline:auto}
.wc-display[data-layout="focus"] .wc-display-author{order:1;font-size:.55em;letter-spacing:.12em}
.wc-display[data-layout="focus"] .wc-display-image-captions{order:2;text-align:start}
@container (max-width:520px){
 .wc-display[data-layout="split"] .wc-display-text{column-count:1}
 .wc-display[data-layout="banner"] .wc-display-grid{grid-template-columns:minmax(64px,.28fr) minmax(0,1fr);column-gap:.7em}
}
@container (max-width:300px){
 .wc-display[data-layout="banner"] .wc-display-grid{display:flex;flex-direction:column}
}
@keyframes wc-display-fade{from{opacity:0}to{opacity:1}}
@keyframes wc-display-slide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.wc-display{animation:none!important}}
`;
