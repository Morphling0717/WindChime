/** Output-only styles: no requests, site background, controls or cached assets. */
export const windChimeDisplayCss = `
.wc-display{display:flex;flex-direction:column;overflow:hidden;position:relative;isolation:isolate;box-sizing:border-box;container-type:inline-size;overflow-wrap:anywhere;min-width:0;max-width:100%;margin:0 auto;line-height:var(--wc-display-leading);color:var(--wc-display-ink);font-family:var(--wc-display-font);font-size:var(--wc-display-size);letter-spacing:var(--wc-display-tracking);padding:var(--wc-display-padding);border:var(--wc-display-border) solid var(--wc-display-accent);border-radius:var(--wc-display-radius);background:var(--wc-display-fill);}
.wc-display *{box-sizing:border-box}
.wc-display .wc-display-viewport{position:relative;z-index:1;min-height:0;flex:1 1 auto;overflow:hidden;scroll-behavior:auto;overflow-anchor:none}
.wc-display .wc-display-grid{position:relative;z-index:1;display:grid;gap:.7em;min-width:0}
.wc-display .wc-display-author{font-size:.58em;letter-spacing:.06em;line-height:1.5;min-width:0;white-space:pre-wrap;opacity:.85}
.wc-display .wc-display-copy{min-width:0}
.wc-display .wc-display-text{white-space:pre-wrap;overflow-wrap:anywhere}
.wc-display .wc-display-link{font-size:.5em;line-height:1.6;opacity:.75;margin-top:1.25em;white-space:pre-wrap;overflow-wrap:anywhere}
.wc-display .wc-display-media{display:grid;gap:.65em;min-width:0;align-content:start}
.wc-display .wc-display-media[data-arrangement="row"]{display:flex;flex-wrap:wrap;align-items:flex-start}
.wc-display .wc-display-media[data-arrangement="grid"]{grid-template-columns:repeat(2,minmax(0,1fr))}
.wc-display .wc-display-media figure{margin:0;min-width:0;max-width:100%}
.wc-display .wc-display-media[data-arrangement="row"] figure{flex:1 1 160px}
.wc-display .wc-display-media img{display:block;max-width:100%;width:100%;height:auto;object-fit:contain;border-radius:min(var(--wc-display-radius),12px)}
.wc-display .wc-display-media figcaption{font-size:.5em;line-height:1.6;margin-top:.45em;white-space:pre-wrap;overflow-wrap:anywhere}
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
.wc-display[data-layout="split"][data-has-media="true"] .wc-display-grid{grid-template-columns:minmax(0,.8fr) minmax(0,1.2fr);column-gap:1.2em}
.wc-display[data-layout="split"] .wc-display-author{grid-column:1/-1}
.wc-display[data-layout="split"][data-has-media="false"] .wc-display-text{column-count:2;column-gap:1.5em}
.wc-display[data-layout="banner"] .wc-display-grid{grid-template-columns:minmax(80px,.23fr) minmax(0,1fr);gap:.7em 1em;align-items:start}
.wc-display[data-layout="banner"] .wc-display-author{grid-column:1;grid-row:1;margin-top:.15em}
.wc-display[data-layout="banner"] .wc-display-copy{grid-column:2;grid-row:1}
.wc-display[data-layout="banner"][data-has-author="false"] .wc-display-copy{grid-column:1/-1}
.wc-display[data-layout="banner"] .wc-display-media{grid-column:1/-1}
@container (max-width:520px){
 .wc-display[data-layout="split"][data-has-media="true"] .wc-display-grid{grid-template-columns:minmax(0,1fr)}
 .wc-display[data-layout="split"][data-has-media="false"] .wc-display-text{column-count:1}
 .wc-display[data-layout="banner"] .wc-display-grid{grid-template-columns:minmax(64px,.28fr) minmax(0,1fr);column-gap:.7em}
}
@container (max-width:300px){
 .wc-display[data-layout="banner"] .wc-display-grid{display:flex;flex-direction:column}
 .wc-display .wc-display-media[data-arrangement="grid"]{grid-template-columns:minmax(0,1fr)}
}
@keyframes wc-display-fade{from{opacity:0}to{opacity:1}}
@keyframes wc-display-slide{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){.wc-display{animation:none!important}}
`;
