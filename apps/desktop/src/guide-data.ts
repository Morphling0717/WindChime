export type GuideJumpTarget =
  | { view: 'inbox' }
  | { view: 'studio'; studioMode?: 'blindbox' | 'workbench'; openObsGuide?: boolean }
  | { view: 'topics' }
  | { view: 'share' }
  | { view: 'settings'; settingsTab: 'appearance' | 'controls' | 'safety' | 'grants' };

export type GuideStep = {
  title: string;
  detail: string;
  badge?: string;
  shortcut?: string;
};

export type GuideChapter = {
  id: string;
  number: string;
  category: '日常开播' | '画面与采集' | '高效进阶';
  title: string;
  shortTitle: string;
  summary: string;
  keywords: string[];
  media: {
    video: string;
    poster: string;
    caption: string;
  };
  steps: GuideStep[];
  tips: string[];
  actions: Array<{
    label: string;
    target: GuideJumpTarget;
    primary?: boolean;
  }>;
};

export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: 'workspace-overview',
    number: '01',
    category: '日常开播',
    title: '先搞清界面分工：收件箱 vs 直播工作台',
    shortTitle: '收件箱 vs 工作台',
    summary: '风铃严格隔离「主播私人控制台」与「观众展示画面」——你在控制台里点选、看信、修改甚至批准，都不会自动泄露给观众，只有主动点上屏才会播出。',
    keywords: ['收件箱', '直播工作台', '批量', '未读', '批准', '防误播', '私人控制台', 'CSV'],
    media: {
      video: 'guide-media/01-workspace-overview.webm',
      poster: 'guide-media/01-workspace-overview.webp',
      caption: '鼠标演示：在收件箱按未读筛选 → 勾选批量批准待播 → 切换到直播工作台查看待播队列',
    },
    steps: [
      {
        title: '「收件箱」适合开播前 / 下播后批量整理',
        badge: '收件箱',
        detail: '支持按「全部 / 未读 / 收藏」筛选、搜索正文和昵称、勾选多封来信一键「批量标为已读」「批量批准待播」「批量删除」或导出 CSV 备份。',
      },
      {
        title: '「直播工作台」用于开播时拆信与控制上屏',
        badge: '直播工作台',
        detail: '内置「盲盒拆信」和「列表备稿」两种模式，右侧状态灯会实时显示「画面为空白」或「正在播出」，让你随时确认观众现在看到的是什么。',
      },
      {
        title: '顶部栏随时切换网站与活动话题',
        detail: '在顶部「当前网站 / 当前话题」下拉框可秒切不同提问箱主题；若切话题时有未保存草稿，风铃会弹窗提醒防止误丢。',
      },
    ],
    tips: [
      '「批准待播」只是把信放进安全待播队列，绝不会直接把信弹到观众画面上，大可放心提前筛选。',
      '左侧导航栏中「直播工作台」右侧的数字徽标，实时提示当前话题还有多少封未拆的新来信。',
    ],
    actions: [
      { label: '前往收件箱', target: { view: 'inbox' } },
      { label: '前往直播工作台', target: { view: 'studio', studioMode: 'blindbox' }, primary: true },
    ],
  },
  {
    id: 'blindbox-live',
    number: '02',
    category: '日常开播',
    title: '开播核心：盲盒拆信、安全上屏与一键隐藏',
    shortTitle: '盲盒拆信与上屏',
    summary: '为单人直播设计的「盲盒拆信」模式：拆封只在你眼前展开、绝不剧透给观众，扫一眼确认无雷再一键上屏，遇突发状况毫秒清屏。',
    keywords: ['盲盒', '拆信', '随机', '上屏', '一键隐藏', 'Ctrl+Shift+H', '切下一封', '列表备稿'],
    media: {
      video: 'guide-media/03-blindbox-live.webm',
      poster: 'guide-media/03-blindbox-live.webp',
      caption: '鼠标演示：点击「拆下一封 ✉」私下预览 → 点「✓ 确认并直接上屏」→ 顶部亮起在播灯 → 点击「一键隐藏」瞬间清屏',
    },
    steps: [
      {
        title: '点击「拆下一封 ✉」私下拆封预览',
        badge: '拆下一封 ✉',
        detail: '在「直播工作台 → 盲盒拆信」点击大按钮拆开下一封来信。此时信件仅显示在你自己的控制台里，观众画面保持安全空白（或保留上一封内容）。',
      },
      {
        title: '快速核对正文与附图后「确认并直接上屏」',
        badge: '✓ 确认并直接上屏',
        detail: '确认没问题后点主按钮直接上屏；若暂时不想播可点「仅加入待播」「✕ 跳过拒绝」「拒收并拉黑」或「放回未拆」。',
      },
      {
        title: '顺序切换或开启「随机拆一封」增加节目效果',
        detail: '播完一封后直接点底部「拆下一封」继续流程，也可用「← 上一封 / 下一封已批准 →」回看已播队列。想玩随机抽签可在「设置 → 播控与热键」打开随机拆信开关。',
      },
      {
        title: '紧急情况随时「一键隐藏」毫秒清空观众画面',
        badge: '■ 一键隐藏',
        shortcut: 'Ctrl+Shift+H',
        detail: '点击右上角红色「一键隐藏」按钮，或在任意软件界面按下全局热键 Ctrl+Shift+H，本地展示窗与 OBS 浏览器源会立刻清空。',
      },
    ],
    tips: [
      '如果想在播前一口气浏览全部来信列表、集中编辑后再按顺序播，点击工作台左上角切换到「列表备稿」模式即可。',
      '盲盒拆信支持在「设置 → 播控与热键」开启「拆下一封时先清空观众画面」，避免上一封信一直挂在画面上。',
    ],
    actions: [
      { label: '前往盲盒拆信工作台', target: { view: 'studio', studioMode: 'blindbox' }, primary: true },
      { label: '切到列表备稿模式', target: { view: 'studio', studioMode: 'workbench' } },
    ],
  },
  {
    id: 'redactor-spotlight',
    number: '03',
    category: '日常开播',
    title: '附图局部打码、长信滚动与大图聚光灯',
    shortTitle: '打码 / 滚动 / 聚光灯',
    summary: '遇到附图里不小心露了微信号/隐私、或者超长小作文与高清细节图？风铃全部内置了一键处理工具，无需切去第三方软件修图。',
    keywords: ['打码', '马赛克', '涂抹', '局部打码', '编辑', '聚光灯', '放大', '长信', '滚动', '提词'],
    media: {
      video: 'guide-media/04-redactor-spotlight.webm',
      poster: 'guide-media/04-redactor-spotlight.webp',
      caption: '鼠标演示：拆信后点开「🖌 局部打码」→ 在画板上拖动涂抹马赛克 → 保存应用到展示稿，安全上屏',
    },
    steps: [
      {
        title: '敏感图片直接「🖌 局部打码」涂抹马赛克',
        badge: '🖌 局部打码',
        detail: '在盲盒拆信卡片中（或列表备稿点开「✎ 编辑 / 打码展示稿」），先点开查看模糊保护的附图，点击图片下方「🖌 局部打码」，按住鼠标拖动即可涂抹马赛克/色块并支持撤销与调整笔刷粗细，保存后只替换本次展示副本，不破坏原图。',
      },
      {
        title: '不想露某张附图可直接「移出本次上屏」',
        detail: '拆信时点击附图下方的「移出本次上屏」可只播文字不播图；若改了主意随时可点「恢复原始附图」。正文、昵称与图片说明同样支持先微调再上屏。',
      },
      {
        title: '长信在播时用「提词同步」1:1 控滚观众画面',
        badge: '在播提词同步',
        detail: '上屏后，直播工作台会变成实时提词框：你用鼠标滚轮边读边滑，或拖动进度条 / 切换自动滚动暂停，OBS 里的观众卡片会 1:1 丝滑同步滚动。',
      },
      {
        title: '带图来信支持「观众大图聚光灯」全屏特写',
        badge: '大图聚光灯',
        detail: '在播提词框下方点击附图的「聚光灯放大」按钮，OBS 展示端会把该图居中放大展示给观众看细节；再次点击或切下一封/一键隐藏时会自动退出。',
      },
    ],
    tips: [
      '带图来信在私人控制台里默认带模糊保护预览，防误触泄露，确认周围环境安全再点开原图检查。',
      '盲盒模式和独立悬浮审阅小窗里都完整支持局部打码画板。',
    ],
    actions: [
      { label: '前往直播工作台体验', target: { view: 'studio', studioMode: 'blindbox' }, primary: true },
    ],
  },
  {
    id: 'obs-setup',
    number: '04',
    category: '画面与采集',
    title: '接入 OBS / 直播姬 & 自由拉长拉宽',
    shortTitle: 'OBS 浏览器源接入',
    summary: '本机 OBS 浏览器源服务已默认自动开启（仅监听 127.0.0.1），复制固定地址贴入 OBS 即可稳定出画，无需常开独立展示窗，也不怕最小化黑屏。',
    keywords: ['OBS', '直播姬', '浏览器源', '窗口捕获', '测试卡', '拉长', '竖屏', '透明', '尺寸'],
    media: {
      video: 'guide-media/02-obs-setup.webm',
      poster: 'guide-media/02-obs-setup.webp',
      caption: '鼠标演示：展开 OBS 采集设置 → 一键复制浏览器源链接 → 发送测试卡对位 OBS 四边边界',
    },
    steps: [
      {
        title: '打开 OBS 采集面板并复制专属本机链接',
        badge: 'OBS 浏览器源',
        detail: '在「直播工作台」右上工具条点击「OBS 浏览器源」（或在「设置与外观 → 播控与热键」），点击「复制链接」。该地址固定持久化，下次开播无需重贴。',
      },
      {
        title: '在 OBS 中添加「浏览器」来源并自由设宽高',
        badge: '来源 + → 浏览器',
        detail: '在 OBS 来源列表点「+」→ 选择「浏览器」→ 粘贴刚复制的 URL。想改竖屏或长横幅，直接修改这里的「宽度 / 高度」（如竖屏 480×860、横屏 1000×640、条幅 1280×360），卡片会自动铺满且文字不变形。',
      },
      {
        title: '点击「测试卡对位 OBS」确认边框和位置',
        badge: '发测试卡对位 OBS',
        detail: '发送测试卡后，OBS 画布会显示带四边虚线框与实时像素尺寸的对位卡；在 OBS 里拖红框四角即可精准摆位，完成后再次点击关闭测试卡。',
      },
      {
        title: '备选：独立透明窗口捕获',
        detail: '若习惯窗口捕获，可在面板切到「方式二：独立透明窗口捕获」，点击打开 WindChime Display 并用预设尺寸按钮一键切换横/竖屏，OBS 选 WGC 模式采集即可。',
      },
    ],
    tips: [
      '当 OBS 成功加载该浏览器源后，面板状态胶囊会自动变成绿色「OBS 浏览器源已连接（1）」，此时无需打开独立窗口即可直接上屏。',
      '如果遇到端口 17420 被其他软件占用，只需在面板里把本机端口改为 17421 等空闲端口再点「应用端口」。',
    ],
    actions: [
      { label: '打开 OBS 采集设置', target: { view: 'studio', openObsGuide: true }, primary: true },
      { label: '前往设置 → 播控与热键', target: { view: 'settings', settingsTab: 'controls' } },
    ],
  },
  {
    id: 'appearance-overlay',
    number: '05',
    category: '画面与采集',
    title: '展示卡片外观定制 & 本机专属角标水印',
    shortTitle: '展示外观与水印',
    summary: '既可以自由调整观众端来信卡片的主题、配色、字体与圆角，还可以在本机叠加你的 Q 版立绘角标、频道文字水印与半透明卡片底图。',
    keywords: ['外观', '主题', '字体', '颜色', '圆角', '水印', '角标', '立绘', '底图', '装饰'],
    media: {
      video: 'guide-media/06-appearance-overlay.webm',
      poster: 'guide-media/06-appearance-overlay.webp',
      caption: '鼠标演示：在「设置 → 展示外观」切换卡片预设并实时预览 → 启用本机装饰叠层调整角标位置与透明度',
    },
    steps: [
      {
        title: '调整观众端卡片样式并实时预览',
        badge: '设置与外观 → 展示外观',
        detail: '在「展示外观」页可调整主题预设、主色调、文字/背景色、字号行距、卡片圆角与内边距、动效开关以及多图排布方式，右侧实时预览所见即所得，改完记得点「应用外观」。',
      },
      {
        title: '开启「本机自定义装饰与水印」叠加专属元素',
        badge: '启用本机装饰叠层',
        detail: '向下滚动到「本机自定义装饰与水印」，打开开关后可上传 PNG / WebP 透明底 Q 版角标、半透明背景叠图，以及最多 40 字的频道文字水印。',
      },
      {
        title: '微调角标四角位置、大小与透明度',
        detail: '一键切换「左上 / 右上 / 左下 / 右下」位置，拖动滑块调节角标尺寸与不透明度，同时会实时同步到顶部预览卡片、测试卡和 OBS 浏览器源中。',
      },
    ],
    tips: [
      '「本机装饰与水印」的图片只保存在你这台电脑本地，不会上传到网站服务器，更换角标零等待。',
      '调完外观后可以直接点顶部的「发测试卡对位 OBS」在 OBS 里看实际叠加效果。',
    ],
    actions: [
      { label: '前往定制展示外观与水印', target: { view: 'settings', settingsTab: 'appearance' }, primary: true },
    ],
  },
  {
    id: 'topics-share',
    number: '06',
    category: '画面与采集',
    title: '话题管理 & 导出高清投稿海报与二维码',
    shortTitle: '话题管理与投稿分享',
    summary: '不同直播活动可以建独立提问箱话题互不串台；「投稿分享」与网页 CMS 海报样式完全同步，一键导出 900px 高清海报与 2x 锐利二维码发动态。',
    keywords: ['话题', '新建话题', '归档', '投稿分享', '海报', '二维码', 'QR', '链接', '动态'],
    media: {
      video: 'guide-media/07-topics-share.webm',
      poster: 'guide-media/07-topics-share.webp',
      caption: '鼠标演示：在「话题管理」查看与管理活动 → 切到「投稿分享」定制海报标题与配色并导出高清海报 PNG',
    },
    steps: [
      {
        title: '在「话题管理」按活动拆分独立信箱',
        badge: '话题管理',
        detail: '可为日常杂谈、生日回、游戏测评等分别新建话题，自定义开放时间段、投稿开关与说明；活动结束后可归档收纳，不干扰日常来信。',
      },
      {
        title: '在「投稿分享」一键复制投稿地址或保存二维码',
        badge: '投稿分享',
        detail: '进入「投稿分享」即可复制当前话题的粉丝投稿网址，或直接点击「保存二维码 PNG」下载高清透明/白底二维码贴到直播间公告或画面角落。',
      },
      {
        title: '自定义高清海报并导出发 B站 / 微博动态',
        badge: '保存海报 PNG',
        detail: '默认自动继承你在网页 CMS 配置的主播自定义海报样式，也支持在桌面端随时调整海报标题、文案、署名、渐变配色、头像与背景图，实时预览并导出 900px 高清 PNG。',
      },
    ],
    tips: [
      '如果改乱了本机海报配色，点一下「恢复站点默认」即可重新同步回你在网页 CMS 里的官方配置。',
      '若想屏蔽某些关键词或拉黑恶意发送者，可在「设置与外观 → 安全与屏蔽」统一管理。',
    ],
    actions: [
      { label: '前往投稿分享做海报', target: { view: 'share' }, primary: true },
      { label: '前往话题管理', target: { view: 'topics' } },
      { label: '安全与屏蔽设置', target: { view: 'settings', settingsTab: 'safety' } },
    ],
  },
  {
    id: 'tiles-hotkeys',
    number: '07',
    category: '高效进阶',
    title: '单屏主播利器：悬浮小窗 & 全局热键',
    shortTitle: '悬浮小窗与全局热键',
    summary: '单显示器或全屏打游戏直播时，不需要切回风铃大窗口：拉出置顶悬浮小窗停靠在屏幕角落，或配合全局快捷键盲操翻页滚屏。',
    keywords: ['悬浮窗', '磁贴', '置顶', '单屏', '快捷键', '热键', '提示音', '风铃声', '液态玻璃'],
    media: {
      video: 'guide-media/05-tiles-hotkeys.webm',
      poster: 'guide-media/05-tiles-hotkeys.webp',
      caption: '鼠标演示：展开工作台「更多悬浮窗 ▾」查看全部置顶磁贴 → 在「播控与热键」配置随机拆信、风铃提示音与全局热键',
    },
    steps: [
      {
        title: '一键弹出置顶「悬浮盲盒小窗 / 悬浮播控小窗」',
        badge: '悬浮盲盒小窗 ↗',
        detail: '在「直播工作台」上方工具条点击「悬浮盲盒小窗 ↗」「悬浮播控小窗 ↗」，或点开「更多悬浮窗 ▾」单独弹出「来信列表 / 信件审阅 / 待播列表 / 展示外观」小窗。',
      },
      {
        title: '悬浮小窗自动记住位置且绝不暴露给观众',
        detail: '每个悬浮小窗默认置顶（可在小窗标题栏切换取消置顶），关闭后再开会自动恢复你上次摆放的大小和坐标。只要 OBS 只采浏览器源或 WindChime Display，观众永远看不到悬浮窗。',
      },
      {
        title: '录制「下一封」与「展示窗滚动」全局快捷键',
        badge: '直播热键',
        detail: '在「设置与外观 → 播控与热键」点击输入框，直接按下如 Ctrl+Alt+N、Alt+↑ / Alt+↓ / Alt+Space 即可保存全局热键，在游戏窗口里也能直接切信和滚屏。',
      },
      {
        title: '按习惯开启新信风铃提示音 & 界面质感切换',
        detail: '同一页面还支持开启「新来信风铃提示音」并调音量、设置启动默认进入「直播工作台」，以及在「液态玻璃 / 标准磨砂 / 轻量省电」三种质感之间一键切换。',
      },
    ],
    tips: [
      '一键隐藏快捷键固定为 Ctrl+Shift+H，录制其他热键时会自动避让防止冲突。',
      '若直播时显卡占用吃紧，把界面质感切到「轻量省电」可显著降低桌面渲染开销，不影响 OBS 展示效果。',
    ],
    actions: [
      { label: '配置热键与桌面偏好', target: { view: 'settings', settingsTab: 'controls' }, primary: true },
      { label: '前往工作台打开悬浮窗', target: { view: 'studio', studioMode: 'blindbox' } },
    ],
  },
  {
    id: 'timeline-chapters',
    number: '08',
    category: '高效进阶',
    title: '开播时间轴自动同步 & 一键导出 B站分段章节',
    shortTitle: '开播时间轴与复盘',
    summary: '直播中每封上屏来信都会自动打点记时；风铃会自动连接 OBS WebSocket / 读 OBS 日志 / 查 B站开播时间对齐录播时间轴，下播秒出切片目录。',
    keywords: ['时间轴', '开播时间', '复盘', 'B站', '章节', '录播', 'OBS WebSocket', '切片', 'Markdown', '导出'],
    media: {
      video: 'guide-media/08-timeline-chapters.webm',
      poster: 'guide-media/08-timeline-chapters.webp',
      caption: '鼠标演示：在「播控与热键」查看开播时间轴自动同步状态 → 回工作台展开「本地播报复盘」一键复制 B站分段章节',
    },
    steps: [
      {
        title: '开播时间轴支持 3 种自动对齐源（零手工记录）',
        badge: '设置 → 播控与热键',
        detail: '风铃已默认开启「OBS WebSocket V5（端口 4455）」与「OBS 本机日志」自动监听，只要你开始推流或录屏就会自动锁定开播基准时间；填入你的 B站直播间号后，还可自动同步平台实际开播时刻。',
      },
      {
        title: '直播结束后在工作台展开「本地播报复盘」',
        badge: '待播队列与本地播报复盘',
        detail: '在「直播工作台」底部展开复盘面板，里面按顺序记录了本场所有上屏过的来信、发送者昵称以及换算好的 00:12:34 录播时间戳。',
      },
      {
        title: '录播有片头延迟？微调偏移或直接选录播文件对齐',
        detail: '在复盘面板可一键切换「按推流 / 按录屏 / 按 B站」轨道、微调 ±秒数偏移，甚至直接点「按录播文件对齐」选中本地 .mkv/.mp4 文件自动校准整场时间轴。',
      },
      {
        title: '一键复制 B站分段章节或导出 Markdown / CSV',
        badge: '📋 复制 B站章节',
        detail: '点击「📋 复制 B站章节」即可直接粘贴到 B站录播视频简介或评论区生成可点击进度条目录，也可导出章节 TXT / Markdown / CSV 留档。',
      },
    ],
    tips: [
      '如果你的 OBS WebSocket 开启了身份验证密码，在「设置 → 播控与热键 → 开播 / 录播时间轴自动同步」里填一次即可加密保存（不填则自动免密连接）。',
      '所有播报复盘记录仅保存在本机电脑，下一次开播前可点「清空记录」开启全新一场。',
    ],
    actions: [
      { label: '配置时间轴自动同步', target: { view: 'settings', settingsTab: 'controls' }, primary: true },
      { label: '去工作台看复盘抽屉', target: { view: 'studio', studioMode: 'blindbox' } },
    ],
  },
];
