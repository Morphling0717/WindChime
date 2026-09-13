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
  approved = new Set();
const appearance = {
  fontFamily: "system-ui",
  fontSize: 32,
  textColor: "#ffffff",
  backgroundColor: "#18202eee",
  transparent: true,
  layout: "card",
  imageLayout: "column",
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
    requests.push({ method: req.method, route });
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
async function until(test, label) {
  for (let i = 0; i < 150; i++) {
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
  await click("使用密钥连接");
  await until(
    () => evaluate('document.querySelectorAll(".inbox-row").length===2'),
    "site import and default topic",
  );
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
  await nav("settings", "设置与外观");
  await until(
    () => evaluate('!!document.querySelector(".setting-toggle input")'),
    "settings loaded",
  );
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
    () => requests.some((r) => r.route === "/control/action"),
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
