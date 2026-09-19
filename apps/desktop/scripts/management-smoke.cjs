// Actual Electron renderer + isolated main process + synthetic loopback API.
// File dialogs resolve only into this run's temporary directory; no real sites or output are opened.
const { app, BrowserWindow, dialog, shell } = require("electron");
const { createServer } = require("node:http"),
  fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const { encodeWindChimeConnectionKey } = require("../build/connection-key.cjs");
const results = path.resolve(__dirname, "../out/management-smoke");
const token = "wc_ctl_" + Buffer.alloc(32, 7).toString("base64url"),
  expiresAt = "2099-01-01T00:00:00Z";
const fixtureTopic = (id, title, isDefault = false) => ({
  id,
  title,
  slug: id,
  description: "合成活动说明",
  note: "私人备注",
  isDefault,
  isEnabled: true,
  startsAt: null,
  endsAt: null,
  archivedAt: null,
  sortOrder: 0,
  createdAt: "2026-09-13T00:00:00Z",
  updatedAt: "2026-09-13T00:00:00Z",
  state: isDefault ? "default" : "active",
  isEnabledNow: true,
  unreadCount: 1,
  flaggedCount: 0,
});
let topics = [
    fixtureTopic("general", "常规收件箱", true),
    fixtureTopic("event-a", "深夜来信"),
  ],
  messages = [
    {
      id: "m1",
      topicId: "general",
      nickname: "纸飞机",
      text: "合成来信：每一封都由你决定。",
      isRead: false,
      isFavorited: false,
      isFlagged: false,
      senderLabel: "发送者 001",
      createdAt: "2026-09-13T00:00:00Z",
    },
    {
      id: "m2",
      topicId: "general",
      nickname: "小风",
      text: "历史被标记来信也能查看。",
      isRead: false,
      isFavorited: false,
      isFlagged: true,
      senderLabel: "发送者 002",
      createdAt: "2026-09-13T00:00:00Z",
    },
    {
      id: "m3",
      topicId: "event-a",
      nickname: "夜猫",
      text: "另一个话题的独立来信。",
      isRead: false,
      isFavorited: false,
      isFlagged: false,
      senderLabel: "发送者 003",
      createdAt: "2026-09-13T00:00:00Z",
    },
  ];
let keywordEnabled = false,
  enabled = true,
  terms = ["旧词"],
  origin,
  control,
  userData,
  confirmResponse = 1,
  confirmCalls = 0,
  revision = 1;
let blocklist = [],
  extraGrantRevokedAt = null;
const requests = [],
  checks = [],
  screenshots = [],
  errors = [],
  opened = [],
  savedFiles = [],
  topicPickerLayouts = [],
  appearanceLayouts = [],
  appearanceStressCases = [],
  approved = new Set();
const responseDelays = new Map();
const appearance = {
  fontFamily: "system-ui",
  fontSize: 32,
  textColor: "#ffffff",
  backgroundColor: "#18202eee",
  transparent: true,
  layout: "stack",
  theme: "pure",
  accentColor: "#2de2e6",
  borderWidth: 0,
  lineHeight: 1.65,
  letterSpacing: 0,
  maxWidth: 1200,
  imageLayout: "column",
  imageHeightPercent: 45,
  animation: "fade",
  borderRadius: 24,
  padding: 32,
};
function live(topicId) {
  return {
    topicId,
    revision,
    epoch: "fixture-epoch",
    messages: messages
      .filter((m) => m.topicId === topicId)
      .map((m) => ({
        ...m,
        source: {
          text: m.text,
          nickname: m.nickname,
          linkUrl: null,
          assets: [],
        },
        draft: {
          text: m.text,
          nickname: m.nickname,
          linkUrl: null,
          assets: [],
        },
        draftRevision: 1,
        status: approved.has(m.id) ? "approved" : "pending",
        snapshotId: approved.has(m.id) ? "snapshot-" + m.id : null,
      })),
    queue: [...approved],
    current: null,
    appearance,
    receivers: 0,
  };
}
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost"),
      route = url.pathname.replace("/api/mail/live", ""),
      chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    requests.push({ method: req.method, route, ...(route === "/control/action" ? { action: body.action } : {}) });
    if (req.method === 'GET' && responseDelays.has(route)) await new Promise(resolve => setTimeout(resolve, responseDelays.get(route)));
    const json = (value, status = 200) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    if (route === "/capabilities")
      return json({
        protocolVersion: 1,
        siteId: "management-fixture",
        features: {
          connectionKeys: true,
          siteControl: true,
          mailManagement: true,
          keywordFilterToggle: true,
          displayThemes: true,
        },
      });
    if (req.headers.authorization !== `Bearer ${token}`)
      return json({ error: "Unauthorized" }, 401);
    if (route === "/control/identity")
      return json({
        siteId: "management-fixture",
        scope: "site",
        topicId: null,
        topicTitle: null,
        grantId: "fixture-key",
        label: "合成站点",
        expiresAt,
      });
    if (route === "/control/topics" && req.method === "GET")
      return json({ items: topics });
    if (route === "/control/topics" && req.method === "POST") {
      const topic = { ...fixtureTopic(body.slug, body.title), ...body };
      topics.push(topic);
      return json(topic);
    }
    if (route.startsWith("/control/topics/")) {
      const id = route.split("/")[3],
        topic = topics.find((t) => t.id === id);
      if (!topic) return json({ error: "Not found" }, 404);
      if (req.method === "DELETE" && route.endsWith("/purge")) {
        topics = topics.filter((t) => t.id !== id);
        return json({ ok: true, topic });
      }
      if (req.method === "PATCH") {
        Object.assign(topic, body);
        topic.state = topic.archivedAt
          ? "archived"
          : topic.isDefault
            ? "default"
            : "active";
        return json(topic);
      }
      if (req.method === "DELETE") {
        topic.archivedAt = new Date().toISOString();
        topic.state = "archived";
        return json({ topic, unreadCount: 0, flaggedCount: 0 });
      }
      return json(topic);
    }
    if (route === "/control/settings") {
      if ("blockedTermsEnabled" in body)
        keywordEnabled = body.blockedTermsEnabled;
      if ("enabled" in body) enabled = body.enabled;
      return json({ enabled, blockedTermsEnabled: keywordEnabled });
    }
    if (route === "/control/blocked-terms") {
      if (body.terms) terms = body.terms;
      return json({ terms });
    }
    if (route === "/control/blocklist") return json(blocklist);
    if (route === "/control/grants")
      return json({
        items: [
          {
            id: "fixture-key",
            label: "合成站点密钥",
            kind: "control",
            scope: "site",
            topicId: null,
            expiresAt,
            revokedAt: null,
          },
          {
            id: "extra-key",
            label: "另一台电脑",
            kind: "control",
            scope: "site",
            topicId: null,
            expiresAt,
            revokedAt: extraGrantRevokedAt,
          },
        ],
      });
    if (route === "/control/share")
      return json({
        siteName: "风铃测试站",
        origin,
        topicId: url.searchParams.get("topicId"),
        topicTitle: "深夜来信",
        submissionUrl: origin + "/m/" + url.searchParams.get("topicId"),
        posterDefaults: {
          title: "把话写给风",
          subtitle: "合成海报验证",
          signature: "风铃测试站",
        },
      });
    const topicId = url.searchParams.get("topicId") || body.topicId;
    if (route === "/control/state") return json(live(topicId));
    if (route === "/control/action") {
      if (body.action === "approve") approved.add(body.messageId);
      if (body.action === "appearance") Object.assign(appearance, body.appearance);
      revision++;
      return json(live(topicId));
    }
    if (route === "/control/message") {
      Object.assign(
        messages.find((m) => m.id === body.messageId),
        body,
      );
      return json(live(topicId));
    }
    if (route === "/control/messages") {
      let items = messages.filter((m) => m.topicId === topicId);
      if (keywordEnabled)
        items = items.filter((m) =>
          url.searchParams.get("filter") === "flagged"
            ? m.isFlagged
            : !m.isFlagged,
        );
      const counts = {
        all: items.length,
        unread: items.filter((m) => !m.isRead).length,
        favorited: items.filter((m) => m.isFavorited).length,
        flagged: messages.filter((m) => m.topicId === topicId && m.isFlagged)
          .length,
      };
      const filter = url.searchParams.get("filter");
      if (filter === "unread") items = items.filter((m) => !m.isRead);
      if (filter === "favorited") items = items.filter((m) => m.isFavorited);
      return json({ items, counts, blockedTermsEnabled: keywordEnabled });
    }
    if (route === "/control/messages/batch") {
      if (body.action === "delete")
        messages = messages.filter((m) => !body.ids.includes(m.id));
      else
        messages
          .filter((m) => body.ids.includes(m.id))
          .forEach((m) => (m.isRead = true));
      return json({ ok: true });
    }
    if (route.startsWith("/control/messages/")) {
      const id = route.split("/")[3],
        item = messages.find((m) => m.id === id && m.topicId === topicId);
      if (!item) return json({ error: "Not found" }, 404);
      if (req.method === "PATCH") Object.assign(item, body);
      if (req.method === "DELETE")
        messages = messages.filter((m) => m.id !== id);
      return json(req.method === "GET" ? item : { ok: true });
    }
    return json({ error: "Unsupported synthetic route" }, 404);
  } catch (error) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: error.message }));
  }
});
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function evaluate(code) {
  return control.webContents.executeJavaScript(code);
}
async function until(test, label, timeout = 15000) {
  for (let i = 0; i < timeout / 100; i++) {
    try {
      if (await test()) return;
    } catch {}
    await pause(100);
  }
  throw new Error("Timed out: " + label);
}
async function click(text) {
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)})?.click()`,
  );
  await pause(100);
}
async function input(selector, value) {
  await evaluate(
    `(()=>{const node=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(node,${JSON.stringify(value)});node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`,
  );
  await pause(80);
}
async function assertVisiblePicker(selector, label) {
  const geometry = await evaluate(
    `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return {missing:true};const rect=node.getBoundingClientRect(),style=getComputedStyle(node),hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);return {count:document.querySelectorAll(${JSON.stringify(selector)}).length,display:style.display,visibility:style.visibility,disabled:node.disabled,x:rect.x,y:rect.y,width:rect.width,height:rect.height,right:rect.right,bottom:rect.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,hit:hit===node||node.contains(hit)};})()`,
  );
  assert.equal(geometry.missing, undefined, label + " exists");
  assert.equal(geometry.count, 1, label + " has no duplicate selector");
  assert.notEqual(geometry.display, "none", label + " is displayed");
  assert.equal(geometry.visibility, "visible", label + " is visible");
  assert.equal(geometry.disabled, false, label + " is enabled");
  assert(geometry.width > 40 && geometry.height > 20, label + " has a usable target");
  assert(geometry.x >= 0 && geometry.y >= 48, label + " is below the title bar");
  assert(
    geometry.right <= geometry.viewportWidth &&
      geometry.bottom <= geometry.viewportHeight,
    label + " fits inside the viewport: " + JSON.stringify(geometry),
  );
  assert.equal(geometry.hit, true, label + " is not covered by another element");
  return geometry;
}
async function selectTopic(topicId, label) {
  await until(
    () => evaluate('!!document.querySelector("#desktop-topic")&&!document.querySelector("#desktop-topic").disabled'),
    label + " topic picker ready",
  );
  await assertVisiblePicker("#desktop-topic", label);
  await input("#desktop-topic", topicId);
}
async function assertTopicContent(view, topicId) {
  const selector = view === "inbox" ? ".inbox-row" : ".wc-mail";
  const expected = topicId === "general" ? "纸飞机" : "夜猫";
  const excluded = topicId === "general" ? "夜猫" : "纸飞机";
  await until(async () => {
    const state = await evaluate(
      `({topic:document.querySelector('#desktop-topic')?.value,rows:Array.from(document.querySelectorAll(${JSON.stringify(selector)})).map(node=>node.textContent).join('\\n')})`,
    );
    return state.topic === topicId && state.rows.includes(expected) && !state.rows.includes(excluded);
  }, view + " isolates " + topicId + " messages");
  const metadata = await evaluate("window.windchimeDesktop.sites()");
  assert.equal(
    metadata.data.items.find((site) => site.id === metadata.data.selectedId).selectedTopicId,
    topicId,
    "main-process topic selection matches visible content",
  );
}
async function verifyTopicPickerLayouts() {
  const sizes = [[1200, 620], [1366, 768], [960, 700], [961, 700], [760, 900]];
  for (const [view, label] of [["inbox", "收件箱"], ["studio", "直播工作台"]]) {
    await nav(view, label);
    for (const [width, height] of sizes) {
      control.setSize(width, height);
      await evaluate("window.scrollTo(0,0)");
      await pause(300);
      const name = `${view}-${width}x${height}`;
      const website = await assertVisiblePicker("#desktop-mailbox", name + " website picker");
      const topic = await assertVisiblePicker("#desktop-topic", name + " topic picker");
      await selectTopic("general", name);
      await assertTopicContent(view, "general");
      await selectTopic("event-a", name);
      await assertTopicContent(view, "event-a");
      topicPickerLayouts.push({ view, requestedSize: [width, height], website, topic });
      if (width === 1200 || width === 961)
        await capture(name, width, height);
    }
  }
  checks.push(
    "inbox and studio website/topic pickers are unique, visible, inside the viewport and unobstructed at 1200x620, 1366x768, 960x700, 961x700 and 760x900; both topic selections isolate their own messages",
  );
  await nav("inbox", "收件箱");
}
async function nav(view, label) {
  await click(label);
  await until(
    () =>
      evaluate(
        `document.querySelector('.wc-desktop')?.dataset.view===${JSON.stringify(view)}`,
      ),
    view,
  );
}
async function capture(name, width = 1440, height = 1000) {
  control.setSize(width, height);
  await pause(300);
  const overflow = await evaluate(
    "document.documentElement.scrollWidth>innerWidth+1",
  );
  assert.equal(overflow, false, "Horizontal layout overflow: " + name);
  await fs.writeFile(
    path.join(results, name + ".png"),
    (await control.webContents.capturePage()).toPNG(),
  );
  screenshots.push(name);
}
async function chooseAppearance(name) {
  await evaluate(`(()=>{const button=Array.from(document.querySelectorAll('.wc-appearance-choice')).find(node=>node.querySelector('.wc-appearance-choice-name')?.firstChild?.textContent.trim()===${JSON.stringify(name)});if(!button)throw new Error('Missing appearance choice');button.click();})()`);
  await pause(100);
}
async function assertAppearancePreview(theme, layout) {
  await until(
    () => evaluate(`(()=>{const card=document.querySelector('.wc-appearance-preview .wc-display');return card?.dataset.theme===${JSON.stringify(theme)}&&card?.dataset.layout===${JSON.stringify(layout)};})()`),
    `private preview shows ${theme} with ${layout}`,
  );
}
async function captureAppearance(name, width, height) {
  control.setSize(width, height);
  await pause(300);
  await evaluate("document.querySelector('.wc-appearance-editor').scrollIntoView({block:'start'});window.scrollBy(0,-64)");
  await pause(300);
  const geometry = await evaluate(`(()=>{const geometry=selector=>{const node=document.querySelector(selector),rect=node.getBoundingClientRect();return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height}};return {preview:geometry('.wc-appearance-viewport'),themes:geometry('.wc-appearance-choices'),viewport:{width:innerWidth,height:innerHeight},imageCount:Array.from(document.querySelectorAll('.wc-appearance-preview img')).filter(node=>node.complete&&node.naturalWidth>0).length,theme:document.querySelector('.wc-appearance-preview .wc-display').dataset.theme,layout:document.querySelector('.wc-appearance-preview .wc-display').dataset.layout}})()`);
  for (const [section, rect] of Object.entries({ preview: geometry.preview, themes: geometry.themes })) {
    assert(rect.width > 200 && rect.height > 50, `${name} ${section} has useful visible dimensions`);
    assert(rect.x >= 0 && rect.y >= 48 && rect.right <= geometry.viewport.width && rect.bottom <= geometry.viewport.height, `${name} ${section} fits the visible viewport: ${JSON.stringify(geometry)}`);
  }
  assert.equal(geometry.imageCount, 2, `${name} loads both local sample images`);
  appearanceLayouts.push({ name, requestedSize: [width, height], ...geometry });
  await capture(name, width, height);
}
async function verifyAppearanceDimensions() {
  await evaluate("document.querySelector('.wc-appearance-advanced').open=true");
  await input('input[aria-label="展示宽度"]', "1920");
  await until(() => evaluate("document.querySelector('.wc-appearance-preview .wc-display')?.offsetWidth===1920&&parseFloat(document.querySelector('.wc-appearance-canvas').style.width)===2000"), "full 1920px card fits an expanded preview canvas");
  const wide = await evaluate(`(()=>{const viewport=document.querySelector('.wc-appearance-viewport'),canvas=document.querySelector('.wc-appearance-canvas'),card=canvas.querySelector('.wc-display'),bounds=viewport.getBoundingClientRect(),rect=card.getBoundingClientRect();return {cardWidth:card.offsetWidth,canvasWidth:canvas.offsetWidth,scaledWidth:rect.width,scale:new DOMMatrixReadOnly(getComputedStyle(canvas).transform).a,contentWidth:viewport.clientWidth,withinPreview:rect.left>=bounds.left&&rect.right<=bounds.left+viewport.clientWidth+1,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
  assert.equal(wide.cardWidth, 1920);
  assert.equal(wide.canvasWidth, 2000);
  assert(Math.abs(wide.scaledWidth - 1920 * wide.scale) < 1, "1920px card scales without being clamped to the old 1200px content area");
  assert.equal(wide.withinPreview, true);
  assert.equal(wide.horizontalOverflow, false);
  appearanceStressCases.push({ name: "maxWidth1920", ...wide });
  await captureAppearance("appearance-maxwidth-1920", 1440, 1200);

  for (const height of [1080, 180, 640]) {
    await input('input[aria-label="展示高度"]', String(height));
    await until(() => evaluate(`document.querySelector('.wc-appearance-preview .wc-display')?.offsetHeight===${height}`), `explicit ${height}px display height reaches the real renderer`);
  }
  appearanceStressCases.push({ name: "displayHeightBounds", heights: [1080, 180, 640], passed: true });
  await input('input[aria-label="展示宽度"]', "280");
  await input('input[aria-label="字号"]', "96");
  await input('input[aria-label="滚动速度"]', "120");
  await input('input[aria-label="顶部停留"]', "0");
  await input('input[aria-label="底部停留"]', "15000");
  await until(() => evaluate(`(()=>{const canvas=document.querySelector('.wc-appearance-canvas'),card=canvas.querySelector('.wc-display'),inner=card.querySelector('.wc-display-viewport');return card.offsetWidth===280&&getComputedStyle(card).fontSize==='96px'&&card.offsetHeight===640&&inner.scrollHeight>inner.clientHeight+100})()`), "96px type in a 280px card overflows only the fixed output viewport");
  const tall = await evaluate(`(()=>{const viewport=document.querySelector('.wc-appearance-viewport'),canvas=document.querySelector('.wc-appearance-canvas'),content=document.querySelector('.wc-appearance-preview-content'),card=canvas.querySelector('.wc-display'),inner=card.querySelector('.wc-display-viewport');return {cardWidth:card.offsetWidth,cardHeight:card.offsetHeight,contentHeight:content.scrollHeight,canvasHeight:canvas.offsetHeight,scrollHeight:inner.scrollHeight,visibleHeight:inner.clientHeight,outerScrollHeight:viewport.scrollHeight,outerHeight:viewport.clientHeight,overflowY:getComputedStyle(viewport).overflowY,previewHorizontalOverflow:viewport.scrollWidth>viewport.clientWidth+1,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1}})()`);
  assert.equal(tall.cardWidth, 280);
  assert.equal(tall.cardHeight, 640, "even an extreme long letter keeps the explicitly selected output height");
  assert.equal(tall.canvasHeight, 720);
  assert(tall.scrollHeight > tall.visibleHeight + 100);
  assert(tall.outerScrollHeight <= tall.outerHeight + 1, "the private outer canvas stays fixed instead of adding a second scroll area");
  assert.equal(tall.overflowY, "hidden");
  assert.equal(tall.previewHorizontalOverflow, false);
  assert.equal(tall.horizontalOverflow, false);
  await captureAppearance("appearance-tall-content-top", 760, 1050);
  let textEndVisible = false;
  await until(async () => {
    const frame = await evaluate(`(()=>{const viewport=document.querySelector('.wc-appearance-preview .wc-display-viewport'),text=viewport.querySelector('.wc-display-text'),range=document.createRange();range.selectNodeContents(text);range.setStart(text.firstChild,text.firstChild.textContent.length-1);const glyph=range.getBoundingClientRect(),bounds=viewport.getBoundingClientRect();return {textEndVisible:glyph.top>=bounds.top&&glyph.bottom<=bounds.bottom,phase:viewport.dataset.scrollPhase};})()`);
    textEndVisible ||= frame.textEndVisible;
    return frame.phase === 'bottom';
  }, "automatic scroll reaches the end of the extreme sample", 60000);
  assert.equal(textEndVisible, true, "the final text character scrolls fully into view without manual scrolling");
  const tail = await evaluate(`(()=>{const card=document.querySelector('.wc-appearance-preview .wc-display'),viewport=card.querySelector('.wc-display-viewport'),bounds=viewport.getBoundingClientRect(),media=card.querySelector('.wc-display-media'),image=media.querySelector('figure:last-child img'),caption=viewport.querySelector('.wc-display-image-captions p:last-child'),ir=image.getBoundingClientRect(),mr=media.getBoundingClientRect(),cr=caption.getBoundingClientRect();return {lastCaption:caption.textContent,lastImageVisible:ir.left>=mr.left&&ir.right<=mr.right+1&&ir.top>=mr.top&&ir.bottom<=mr.bottom+1,lastCaptionVisible:cr.top>=bounds.top&&cr.bottom<=bounds.bottom+1,imageScrolls:viewport.contains(image),scrollTop:viewport.scrollTop,maxScroll:viewport.scrollHeight-viewport.clientHeight}})()`);
  assert(tail.lastCaption.endsWith("月下微风"));
  assert.equal(tail.imageScrolls, false, "images remain outside the text scroll viewport");
  assert.equal(tail.lastImageVisible, true, "the complete final image stays visible in the stationary lower panel");
  assert.equal(tail.lastCaptionVisible, true, "the complete final caption is reachable");
  assert(Math.abs(tail.scrollTop - tail.maxScroll) < 1, "preview reaches the actual end without a clipped tail");
  appearanceStressCases.push({ name: "fontSize96-maxWidth280", ...tall, ...tail });
  await captureAppearance("appearance-tall-content-bottom", 760, 1050);
  checks.push("1920px maximum width expands the real preview canvas; 96px type in a 280px card stays inside a fixed 640px output and scrolls through the final text and caption while images remain fully visible below, without a second outer scroll area or horizontal overflow");
}
async function verifyAppearanceEditor() {
  await until(() => evaluate("!!document.querySelector('.wc-appearance-editor')&&!document.querySelector('.wc-appearance-apply').disabled"), "new appearance controls loaded");
  const appearanceWrites = () => requests.filter(request => request.action === "appearance").length;
  const before = appearanceWrites();
  await chooseAppearance("文字双栏");
  await chooseAppearance("Mia · 星祷");
  await assertAppearancePreview("mia", "split");
  assert.equal(appearanceWrites(), before, "theme and layout changes stay private before applying");
  assert.equal(appearance.theme, "pure");
  assert.equal(appearance.layout, "stack");
  await captureAppearance("appearance-mia-wide", 1440, 1200);
  await captureAppearance("appearance-mia-narrow", 760, 1050);
  await click("应用外观");
  await until(() => appearance.theme === "mia" && appearance.layout === "split", "appearance action persists both independent choices");
  assert.equal(appearanceWrites(), before + 1, "one explicit apply issues one appearance action");
  await until(() => evaluate("document.querySelector('.wc-appearance-save-state')?.textContent==='外观已同步'"), "appearance apply clears dirty state");
  await nav("topics", "话题管理");
  await nav("settings", "设置与外观");
  await assertAppearancePreview("mia", "split");
  assert.equal(appearanceWrites(), before + 1, "remount restores the saved server appearance without sending an action");
  await chooseAppearance("UliUli · 夜航");
  await assertAppearancePreview("uliuli", "split");
  assert.equal(appearanceWrites(), before + 1, "switching the theme preserves split layout and stays private");
  assert.equal(appearance.theme, "mia");
  confirmResponse = 0;
  await evaluate("window.scrollTo(0,0)");
  const canceled = confirmCalls;
  await selectTopic("general", "dirty appearance topic change");
  await until(() => confirmCalls > canceled, "topic change asks about unsaved appearance");
  assert.equal(await evaluate("document.querySelector('#desktop-topic').value"), "event-a");
  await assertAppearancePreview("uliuli", "split");
  assert.equal(appearanceWrites(), before + 1, "canceling topic change cannot save local appearance");
  await captureAppearance("appearance-uliuli-wide", 1440, 1200);
  await captureAppearance("appearance-uliuli-narrow", 760, 1050);
  await verifyAppearanceDimensions();
  assert.equal(appearanceWrites(), before + 1, "extreme preview dimensions never update the saved appearance");
  confirmResponse = 1;
  await nav("topics", "话题管理");
  await nav("settings", "设置与外观");
  await assertAppearancePreview("mia", "split");
  await evaluate("window.scrollTo(0,0)");
  checks.push("real appearance editor previews Mia and split privately, saves once through the appearance action, restores persisted choices after remount, preserves split while selecting UliUli, and canceling a topic change retains unsaved local appearance; both themes and their shared renderer preview are visible at wide and narrow sizes");
}
async function run() {
  userData = await fs.mkdtemp(path.join(os.tmpdir(), "windchime-management-"));
  app.setPath("userData", userData);
  await fs.mkdir(results, { recursive: true });
  dialog.showMessageBox = async () => {
    confirmCalls++;
    return { response: confirmResponse, checkboxChecked: false };
  };
  dialog.showSaveDialog = async (_window, options) => {
    const filePath = path.join(userData, path.basename(options.defaultPath));
    savedFiles.push(filePath);
    return { canceled: false, filePath };
  };
  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [path.resolve(__dirname, "../build/icon.png")],
  });
  shell.openExternal = async (url) => {
    opened.push(url);
  };
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => {
    assert.equal(
      new URL(typeof input === "string" ? input : input.url).origin,
      origin,
    );
    return originalFetch(input, options);
  };
  app.on("browser-window-created", (_, window) =>
    window.webContents.on("console-message", (_event, level, text) => {
      if (level === 3) errors.push(text);
    }),
  );
  require("../main.cjs");
  await app.whenReady();
  await until(() => {
    control = BrowserWindow.getAllWindows().find((w) =>
      w.getTitle().includes("私人控制台"),
    );
    return control;
  }, "private window");
  control.show();
  control.focus();
  await until(
    () => evaluate('document.visibilityState==="visible"'),
    "visible test window enables normal topic polling",
  );
  await until(
    () => evaluate('!!document.querySelector("input[type=password]")'),
    "key form",
  );
  await input(
    "input[type=password]",
    encodeWindChimeConnectionKey({
      origin,
      siteId: "management-fixture",
      token,
    }),
  );
  responseDelays.set('/control/messages', 4500);
  await click("使用密钥连接");
  await until(
    () => evaluate('document.querySelectorAll(".inbox-row").length===2'),
    "site import and default topic",
  );
  responseDelays.delete('/control/messages');
  checks.push('inbox requests taking 4.5 seconds complete across the 3-second poll interval without response starvation');
  checks.push(
    "site key imports through real form; default topic selected; historical flagged mail visible with keyword filter disabled",
  );
  const metadata = await evaluate("window.windchimeDesktop.sites()");
  assert.equal(metadata.data.items[0].scope, "site");
  assert.equal(metadata.data.items[0].topicId, null);
  assert(!JSON.stringify(metadata).includes(token));
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  await evaluate('document.querySelector(".inbox-row>button").click()');
  await until(() => messages[0].isRead, "opening original marks read");
  await click("收藏");
  await until(() => messages[0].isFavorited, "favorite");
  await click("导出 当前列表 CSV");
  await until(
    () => savedFiles.some((file) => file.endsWith(".csv")),
    "CSV save",
  );
  assert(
    (
      await fs.readFile(
        savedFiles.find((file) => file.endsWith(".csv")),
        "utf8",
      )
    ).includes("纸飞机"),
  );
  checks.push(
    "inbox original/read/favorite and CSV saved through restricted main-process dialog",
  );
  await capture("inbox-wide");
  await capture("inbox-narrow", 760, 900);
  await evaluate(
    'Array.from(document.querySelectorAll(".management-filters button")).find(b=>b.textContent.startsWith("未读")).click()',
  );
  await until(
    () => evaluate('document.querySelectorAll(".inbox-row").length===1'),
    "unread filter",
  );
  await evaluate('document.querySelector(".inbox-row>button").click()');
  await until(() => messages[1].isRead, "opening last unread marks it read");
  await until(
    () =>
      evaluate(
        'document.querySelectorAll(".inbox-row").length===0&&document.querySelector(".original-mail")?.textContent.includes("历史被标记")',
      ),
    "unread detail remains after list removes read item",
  );
  checks.push(
    "original remains readable after opening the last unread message removes its unread-list row",
  );
  topics.push(fixtureTopic("new-live", "刚发布的活动"));
  await until(
    () =>
      evaluate(
        'document.querySelectorAll("#desktop-mailbox option").length>0&&Array.from(document.querySelectorAll("#desktop-topic option")).some(o=>o.value==="new-live")',
      ),
    "new topic polling",
  );
  await selectTopic("event-a", "new topic synchronization");
  await until(
    () =>
      evaluate(
        'document.querySelectorAll(".inbox-row").length===1&&document.querySelector(".inbox-row").textContent.includes("夜猫")',
      ),
    "topic switching",
  );
  checks.push(
    "new website activity appears within polling; topic switch isolates messages",
  );
  await verifyTopicPickerLayouts();
  await nav("topics", "话题管理");
  await capture("topics-wide");
  await click("新建话题");
  await input('.topic-editor input[maxlength="80"]', "新活动");
  await input(".topic-editor input[pattern]", "new-topic");
  await click("保存话题");
  await until(
    () => topics.some((t) => t.slug === "new-topic"),
    "topic creation",
  );
  checks.push("topic creation uses shared management route");
  await nav("share", "投稿分享");
  await until(
    () =>
      evaluate('document.querySelector(".poster-preview canvas")?.width===720'),
    "poster render",
  );
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="保存二维码 PNG"&&!b.disabled)',
      ),
    "QR ready",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".share-grid input[maxlength]").value',
    ),
    "把话写给风",
    "server poster title mapping",
  );
  await input(".share-grid input[maxlength]", "私藏的海报标题");
  await input('input[aria-label="海报署名"]', "桌面署名测试");
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="保存海报 PNG"&&!b.disabled)',
      ),
    "custom poster ready",
  );
  const posterWithoutAvatar = await evaluate(
    'document.querySelector(".poster-preview canvas").toDataURL()',
  );
  await click("选择本机头像");
  await until(
    () =>
      evaluate('!!document.querySelector(".poster-avatar img")?.naturalWidth'),
    "local avatar normalized and rendered",
  );
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="保存海报 PNG"&&!b.disabled)',
      ),
    "avatar poster ready",
  );
  assert.notEqual(
    await evaluate(
      'document.querySelector(".poster-preview canvas").toDataURL()',
    ),
    posterWithoutAvatar,
    "avatar changes actual canvas pixels",
  );
  await click("保存二维码 PNG");
  await click("保存海报 PNG");
  await until(
    () => savedFiles.filter((file) => file.endsWith(".png")).length === 2,
    "PNG save",
  );
  for (const file of savedFiles.filter((file) => file.endsWith(".png")))
    assert.deepEqual(
      (await fs.readFile(file)).subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
  await click("在浏览器打开投稿页");
  assert.equal(opened[0], origin + "/m/event-a");
  checks.push(
    "shared QR/poster renderer, local normalized avatar and actual PNG saves; safe server-provided submission link",
  );
  await nav("topics", "话题管理");
  await nav("share", "投稿分享");
  await until(
    () =>
      evaluate(
        'document.querySelector(".share-grid input[maxlength]")?.value==="私藏的海报标题"',
      ),
    "poster preferences restored after remount",
  );
  assert.equal(
    await evaluate(
      'document.querySelector("input[aria-label=海报署名]").value',
    ),
    "桌面署名测试",
  );
  await until(
    () =>
      evaluate('!!document.querySelector(".poster-avatar img")?.naturalWidth'),
    "saved local avatar restored",
  );
  checks.push(
    "poster title/signature/avatar preferences survive share view remount without persisting credentials or mail",
  );
  await capture("share-wide");
  for (const route of ['/control/settings', '/control/blocklist', '/control/grants']) responseDelays.set(route, 4500);
  await nav("settings", "设置与外观");
  await until(
    () => evaluate('!!document.querySelector(".setting-toggle input")'),
    "settings loaded",
  );
  await until(() => evaluate('Array.from(document.querySelectorAll(".blocked-sender")).some(node=>node.textContent.includes("另一台电脑"))'), 'slow settings and grant requests complete');
  responseDelays.clear();
  checks.push('settings, blocklist and grants taking 4.5 seconds finish without being repeatedly cancelled by polling');
  await verifyAppearanceEditor();
  await evaluate(
    'document.querySelectorAll(".setting-toggle input")[1].click()',
  );
  await until(() => keywordEnabled, "keyword toggle");
  await until(
    () => evaluate('!!document.querySelector(".management textarea")'),
    "keyword editor",
  );
  await input(".management textarea", "新敏感词\n辅助词");
  await click("保存敏感词");
  await until(() => terms.includes("新敏感词"), "keyword save");
  checks.push(
    "site-wide keyword toggle and terms editor use main-process authenticated routes",
  );
  await capture("settings-wide");
  await input(".management textarea", "尚未保存的本地词表");
  terms = ["网页更新的词表"];
  blocklist = [
    {
      hash: "external-sender",
      label: "外部新增屏蔽",
      blockedAt: new Date().toISOString(),
      sampleText: "合成样本",
    },
  ];
  extraGrantRevokedAt = new Date().toISOString();
  enabled = false;
  await until(
    () =>
      evaluate(
        'document.body.textContent.includes("外部新增屏蔽")&&Array.from(document.querySelectorAll(".blocked-sender")).some(node=>node.textContent.includes("另一台电脑")&&node.textContent.includes("已撤销"))',
      ),
    "external blocklist and grant revocation synchronize",
  );
  assert.equal(
    await evaluate('document.querySelector(".management textarea").value'),
    "尚未保存的本地词表",
    "external terms do not replace dirty edit",
  );
  assert.equal(
    await evaluate(
      'document.querySelectorAll(".setting-toggle input")[0].checked',
    ),
    false,
    "external submission setting synchronizes",
  );
  control.hide();
  await until(
    () => evaluate('document.visibilityState==="hidden"'),
    "hidden private window",
  );
  await pause(300);
  const settingsRequests = requests.filter(
    (r) => r.route === "/control/settings",
  ).length;
  await pause(3400);
  assert.equal(
    requests.filter((r) => r.route === "/control/settings").length,
    settingsRequests,
    "hidden management does not poll",
  );
  enabled = true;
  control.show();
  control.focus();
  await until(
    () =>
      evaluate('document.querySelectorAll(".setting-toggle input")[0].checked'),
    "visible window refreshes setting",
  );
  checks.push(
    "external settings/blocklist/grants synchronize while visible; hidden pauses reads; focus refreshes immediately; dirty terms preserved",
  );
  await nav("studio", "直播工作台");
  await until(
    () => evaluate('!!document.querySelector(".wc-mail")'),
    "studio loaded",
  );
  await evaluate('document.querySelector(".wc-mail").click()');
  await until(
    () =>
      evaluate(
        '!!document.querySelector(".desktop-studio textarea[maxlength]")',
      ),
    "reviewer",
  );
  await input(".desktop-studio textarea[maxlength]", "这是一份未保存的稿件");
  confirmResponse = 0;
  await evaluate("window.scrollTo(0,0)");
  const canceledTopicConfirm = confirmCalls;
  await selectTopic("general", "dirty studio topic change");
  await until(() => confirmCalls > canceledTopicConfirm, "topic change asks about dirty draft");
  await assertTopicContent("studio", "event-a");
  assert.equal(
    await evaluate('document.querySelector(".desktop-studio textarea[maxlength]").value'),
    "这是一份未保存的稿件",
    "canceling topic change preserves the unsaved draft",
  );
  await click("收件箱");
  assert.equal(
    await evaluate('document.querySelector(".wc-desktop").dataset.view'),
    "studio",
  );
  assert.equal(
    await evaluate(
      'document.querySelector(".desktop-studio textarea[maxlength]").value',
    ),
    "这是一份未保存的稿件",
  );
  confirmResponse = 1;
  const acceptedTopicConfirm = confirmCalls;
  await selectTopic("general", "confirmed studio topic change");
  await until(() => confirmCalls > acceptedTopicConfirm, "confirmed topic change prompts first");
  await assertTopicContent("studio", "general");
  assert.equal(
    await evaluate('Array.from(document.querySelectorAll(".desktop-studio textarea")).some(node=>node.value==="这是一份未保存的稿件")'),
    false,
    "confirmed topic change discards the previous topic draft",
  );
  await nav("inbox", "收件箱");
  await selectTopic("event-a", "restore poster preference fixture topic");
  await assertTopicContent("inbox", "event-a");
  checks.push(
    "canceling topic or page changes preserves the studio topic and dirty draft; confirming a topic change selects the new topic and removes the previous unsaved draft",
  );
  await evaluate('document.querySelector(".desktop-hide").click()');
  await until(
    () => requests.some((r) => r.route === "/control/action" && r.action === "hide"),
    "emergency hide",
  );
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  checks.push(
    "emergency hide remains available; management navigation never opens output or approves mail",
  );
  assert.equal(errors.length, 0, errors.join("\n"));
  const report = {
    passed: true,
    version: require("../package.json").version,
    electron: process.versions.electron,
    checks,
    screenshots,
    topicPickerLayouts,
    appearanceLayouts,
    appearanceStressCases,
    savedFiles: await Promise.all(
      savedFiles.map(async (file) => ({
        path: file,
        bytes: (await fs.stat(file)).size,
      })),
    ),
    profile: userData,
    requests: requests.length,
    consoleErrors: errors,
    at: new Date().toISOString(),
  };
  await fs.writeFile(
    path.join(results, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  require("electron")
    .session.fromPartition("persist:windchime-private")
    .flushStorageData();
  await pause(150);
  server.closeAllConnections();
  server.close();
  app.exit(0);
}
run().catch(async (error) => {
  await fs.mkdir(results, { recursive: true });
  let rendererState = null;
  if (control && !control.isDestroyed()) {
    try {
      rendererState = await evaluate(`({view:document.querySelector('.wc-desktop')?.dataset.view,visibility:document.visibilityState,text:document.body.innerText,topic:document.querySelector('#desktop-topic')?.value,keyLength:document.querySelector('input[type=password]')?.value.length})`);
      await fs.writeFile(path.join(results, "failure.png"), (await control.webContents.capturePage()).toPNG());
    } catch {}
  }
  await fs.writeFile(
    path.join(results, "failure.json"),
    JSON.stringify({
      passed: false,
      error: error.message,
      checks,
      topicPickerLayouts,
      appearanceLayouts,
      appearanceStressCases,
      rendererState,
      requests,
      consoleErrors: errors,
    }),
  );
  console.error(error.stack);
  server.closeAllConnections();
  server.close();
  app.exit(1);
});
