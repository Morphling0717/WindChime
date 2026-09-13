import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { WindChimeLiveControlPanel } from '../dist/broadcast/ControlPanel.js';
import { WindChimeLiveCard, WindChimeLiveDisplay } from '../dist/broadcast/Display.js';
import { AppearanceEditor } from '../dist/broadcast/AppearanceEditor.js';
import { DEFAULT_WINDCHIME_LIVE_APPEARANCE as appearance } from '../dist/core/live.js';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function connectionFixture(t, props = {}, overrides = {}) {
  const state = { topicId:'topic',revision:1,epoch:'epoch',messages:[],queue:[],current:null,appearance,receivers:0 };
  const client = { state:async()=>structuredClone(state),grants:async()=>({items:[]}),...overrides };
  let renderer;
  await act(async()=>{renderer=create(React.createElement(WindChimeLiveControlPanel,{client,topicId:'topic',...props}));});
  t.after(async()=>{await act(async()=>renderer.unmount());});
  const button = label => renderer.root.findAllByType('button').find(node=>node.children.join('')===label);
  const click = async label => { const found=button(label);assert(found,`Missing button: ${label}`);assert(!found.props.disabled);await act(async()=>{found.props.onClick();await new Promise(resolve=>setImmediate(resolve));}); };
  return { renderer,button,click };
}

test('default local controls omit platform and unconfigured links while keeping device and output controls', async t => {
  let opened=0,platformCalls=0;
  const fixture=await connectionFixture(t,{onOpenDisplay:async()=>{opened++;},onBindGateway:async()=>{platformCalls++;}});
  assert.equal(fixture.button('生成只读展示链接'),undefined);
  assert.equal(fixture.button('复制展示链接'),undefined);
  assert.equal(fixture.button('连接 B 站会话'),undefined);
  assert.equal(fixture.button('生成绑定挑战'),undefined);
  assert.equal(fixture.button('确认绑定'),undefined);
  assert(!JSON.stringify(fixture.renderer.toJSON()).includes('连接 B 站启动网关'));
  assert(fixture.button('批准此设备连接当前信箱'));
  await fixture.click('打开独立展示窗口');assert.equal(opened,1);assert.equal(platformCalls,0);
});

test('explicit platform opt-in keeps binding and configured desktop link callbacks operational', async t => {
  let bound=0,copied=0;
  const fixture=await connectionFixture(t,{enablePlatformIntegration:true,onBindGateway:async()=>{bound++;},onCopyDisplayLink:async()=>{copied++;}});
  assert(JSON.stringify(fixture.renderer.toJSON()).includes('连接 B 站启动网关'));
  assert(fixture.button('生成绑定挑战'));
  await fixture.click('连接 B 站会话');await fixture.click('生成只读展示链接');
  assert.equal(bound,1);assert.equal(copied,1);
});

test('configured ordinary display URL issues a scoped display link without enabling platform controls', async t => {
  const oldWindow=globalThis.window;globalThis.window={location:{origin:'https://mail.example.test'}};
  t.after(()=>{globalThis.window=oldWindow;});
  const grants=[];
  const fixture=await connectionFixture(t,{displayUrl:'https://output.example.test/display'},{createGrant:async(...args)=>{grants.push(args);return {token:'wc_disp_fixture'};}});
  await fixture.click('生成只读展示链接');
  assert.deepEqual(grants,[['topic','display','直播展示页']]);
  const link=fixture.renderer.root.find(node=>node.props.className==='wc-grant-url').children.join('');
  const url=new URL(link),fragment=new URLSearchParams(url.hash.slice(1));
  assert.equal(url.origin,'https://output.example.test');assert.equal(fragment.get('siteBaseUrl'),'https://mail.example.test/api/mail/live');assert.equal(fragment.get('token'),'wc_disp_fixture');
  assert(fixture.button('复制展示链接'));assert.equal(fixture.button('连接 B 站会话'),undefined);
});

async function reviewFixture(t, actionHandler, props = {}) {
  const draft = { text: 'Saved original', nickname: 'Checked', linkUrl: null, assets: [] };
  let state = { topicId: 'topic', revision: 4, epoch: 'epoch', messages: [{ id: 'mail', createdAt: '2026-09-10T10:00:00Z', isRead: false, isFavorited: false, isFlagged: false, source: structuredClone(draft), draft: structuredClone(draft), draftRevision: 4, status: 'pending', snapshotId: null }], queue: [], current: null, appearance, receivers: 1 };
  const commands = [];
  const client = { state: async () => structuredClone(state), grants: async () => ({ items: [] }), action: async command => { commands.push(structuredClone(command)); return actionHandler(command, fixture); } };
  const fixture = {
    get state() { return state; }, set state(next) { state = next; }, commands,
    saved(command) {
      const next = structuredClone(state); next.revision++;
      if (command.action === 'draft') {
        const input = command.draft;
        next.messages[0].draft = { ...structuredClone(input), text: input.text.trim(), nickname: input.nickname?.trim() || null, linkUrl: input.linkUrl ? new URL(input.linkUrl.trim()).toString() : null };
        next.messages[0].draftRevision++;
      }
      return next;
    },
  };
  let renderer;
  t.after(async () => { if (renderer) await act(async () => renderer.unmount()); });
  await act(async () => { renderer = create(React.createElement(WindChimeLiveControlPanel, { client, topicId: 'topic', ...props })); });
  fixture.renderer = renderer;
  fixture.button = label => renderer.root.findAllByType('button').find(node => node.children.join('') === label);
  fixture.field = label => renderer.root.findAllByType('label').find(node => node.children[0] === label).findByType(label === '展示正文' ? 'textarea' : 'input');
  fixture.edit = async (label, value) => act(async () => fixture.field(label).props.onChange({ target: { value } }));
  fixture.click = async label => act(async () => { fixture.button(label).props.onClick(); await new Promise(resolve => setImmediate(resolve)); });
  fixture.hasConflict = () => JSON.stringify(renderer.toJSON()).includes('展示稿已在其他控制端更新为版本');
  await act(async () => renderer.root.find(node => node.type === 'button' && node.props.className === 'wc-mail').props.onClick());
  return fixture;
}

test('dirty notification covers unsaved review and appearance without exposing disabled keyword markers', async t => {
  const notifications = [];
  const f = await reviewFixture(t, async (command, fixture) => {
    fixture.state = fixture.saved(command);
    if (command.action === 'appearance') fixture.state.appearance = command.appearance;
    return structuredClone(fixture.state);
  }, { onDirtyChange: dirty => notifications.push(dirty) });
  assert.equal(notifications.at(-1), false);
  await f.edit('展示正文', 'not saved'); assert.equal(notifications.at(-1), true);
  await f.click('保存展示稿'); assert.equal(notifications.at(-1), false);
  const font = f.renderer.root.findAllByType('label').find(node => node.children[0] === '字号').findByType('input');
  await act(async () => font.props.onChange({ target: { value: '38' } }));
  assert.equal(notifications.at(-1), true);
  await f.click('应用外观'); assert.equal(notifications.at(-1), false);
  f.state.messages[0].isFlagged = true;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
  assert(!JSON.stringify(f.renderer.toJSON()).includes('敏感词标记'));
});

test('remote appearance updates cannot overwrite an unsaved local appearance', async t => {
  const f = await reviewFixture(t, async (command, fixture) => structuredClone(fixture.state));
  const font = () => f.renderer.root.findAllByType('label').find(node => node.children[0] === '字号').findByType('input');
  await act(async () => font().props.onChange({ target: { value: '39' } }));
  f.state = { ...f.state, revision: f.state.revision + 1, appearance: { ...f.state.appearance, fontSize: 50 } };
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
  assert.equal(font().props.value, 39);
  assert(f.button('应用外观').props.disabled);
  assert(JSON.stringify(f.renderer.toJSON()).includes('外观已在另一控制端更新'));
  await f.click('确认新外观，保留我的编辑');
  assert.equal(font().props.value, 39); assert.equal(f.button('应用外观').props.disabled, false);
});

test('own save adopts URL and whitespace normalization without a false remote conflict', async t => {
  const f = await reviewFixture(t, async (command, fixture) => { fixture.state = fixture.saved(command); return structuredClone(fixture.state); });
  await f.edit('展示正文', '  已审正文  '); await f.edit('展示称呼', '  审核昵称  ');
  await f.edit('展示链接文字', ' https://example.invalid/仅展示文字 ');
  await f.click('保存展示稿');
  assert.equal(f.field('展示正文').props.value, '已审正文');
  assert.equal(f.field('展示称呼').props.value, '审核昵称');
  assert.equal(f.field('展示链接文字').props.value, 'https://example.invalid/%E4%BB%85%E5%B1%95%E7%A4%BA%E6%96%87%E5%AD%97');
  assert.equal(f.hasConflict(), false);
  assert.equal(f.button('保存展示稿').props.disabled, true, 'normalized saved draft is clean');
  assert.equal(f.button('批准进入待播').props.disabled, false);
  await f.click('批准进入待播');
  assert.equal(f.commands.at(-1).expectedDraftRevision, 5, 'approval uses the version that was actually saved');
});

test('typing while own save is pending preserves new local input and advances the saved basis', async t => {
  let complete;
  const f = await reviewFixture(t, async (command, fixture) => {
    const response = fixture.saved(command);
    return new Promise(resolve => { complete = () => { fixture.state = response; resolve(structuredClone(response)); }; });
  });
  await f.edit('展示正文', '  Submitted version  '); await f.click('保存展示稿');
  await f.edit('展示正文', 'Typed while saving');
  await act(async () => { complete(); await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(f.field('展示正文').props.value, 'Typed while saving');
  assert.equal(f.hasConflict(), false);
  assert.equal(f.button('保存展示稿').props.disabled, false, 'the new local draft remains dirty and can be saved');
  assert.equal(f.button('批准进入待播').props.disabled, true);
  await f.click('保存展示稿');
  assert.equal(f.commands.at(-1).expectedDraftRevision, 5);
  assert.equal(f.commands.at(-1).draft.text, 'Typed while saving');
  await act(async () => { complete(); await new Promise(resolve => setImmediate(resolve)); });
});

for (const acknowledge of [false, true]) test(`late own save response preserves a real newer remote edit${acknowledge ? ' already acknowledged locally' : ''}`, async t => {
  let complete;
  const f = await reviewFixture(t, async (command, fixture) => {
    const response = fixture.saved(command); fixture.state = structuredClone(response);
    return new Promise(resolve => { complete = () => resolve(structuredClone(response)); });
  });
  await f.edit('展示正文', 'My submitted text'); await f.click('保存展示稿');
  await f.edit('展示正文', 'My newer unsaved input');
  const remote = structuredClone(f.state); remote.revision++; remote.messages[0].draftRevision++; remote.messages[0].draft.text = 'A real remote edit'; f.state = remote;
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)); });
  assert.equal(f.hasConflict(), true);
  if (acknowledge) await f.click('确认新版本，保留我的编辑');
  await act(async () => { complete(); await new Promise(resolve => setImmediate(resolve)); });
  assert.equal(f.field('展示正文').props.value, 'My newer unsaved input');
  assert.equal(f.hasConflict(), !acknowledge, 'the older response neither hides a remote conflict nor rolls back explicit acknowledgement');
  assert.equal(f.button('保存展示稿').props.disabled, !acknowledge);
  assert.equal(f.button('批准进入待播').props.disabled, true);
  if (!acknowledge) await f.click('载入最新版本，放弃本地改动');
  if (!acknowledge) {
    assert.equal(f.field('展示正文').props.value, 'A real remote edit');
    assert.equal(f.button('批准进入待播').props.disabled, false);
  }
});

test('remote edit retains private local draft and requires explicit version choice before save or approve', async () => {
  const draft={text:'Original saved draft',nickname:'Checked',linkUrl:null,assets:[]};
  let state={topicId:'topic',revision:1,epoch:'epoch',messages:[{id:'mail',createdAt:'2026-09-10T10:00:00Z',isRead:false,isFavorited:false,isFlagged:false,source:structuredClone(draft),draft:structuredClone(draft),draftRevision:1,status:'pending',snapshotId:null}],queue:[],current:null,appearance,receivers:1};
  const commands=[];
  const client={state:async()=>structuredClone(state),grants:async()=>({items:[]}),action:async command=>{commands.push(command);state=structuredClone(state);state.revision++;if(command.action==='draft'){state.messages[0].draft=command.draft;state.messages[0].draftRevision++;}return structuredClone(state);}};
  let renderer;
  try {
    await act(async()=>{renderer=create(React.createElement(WindChimeLiveControlPanel,{client,topicId:'topic'}));});
    const button=label=>renderer.root.findAllByType('button').find(node=>node.children.join('')===label);
    await act(async()=>{renderer.root.find(node=>node.type==='button'&&node.props.className==='wc-mail').props.onClick();});
    await act(async()=>{renderer.root.findAllByType('textarea').find(node=>node.props.value==='Original saved draft').props.onChange({target:{value:'MY_UNSAVED_PRIVATE_DRAFT'}});});
    state=structuredClone(state);state.revision=2;state.messages[0].draftRevision=2;state.messages[0].draft.text='OTHER_EDITOR_NEW_VERSION';
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    assert(renderer.root.findAllByType('textarea').some(node=>node.props.value==='MY_UNSAVED_PRIVATE_DRAFT'),'polling must not discard local edits');
    assert.equal(button('批准进入待播').props.disabled,true);
    assert.equal(button('保存展示稿').props.disabled,true);
    await act(async()=>{button('确认新版本，保留我的编辑').props.onClick();});
    assert.equal(button('保存展示稿').props.disabled,false);
    await act(async()=>{await button('保存展示稿').props.onClick();await new Promise(resolve=>setImmediate(resolve));});
    assert.equal(commands.at(-1).expectedDraftRevision,2);
    assert.equal(commands.at(-1).draft.text,'MY_UNSAVED_PRIVATE_DRAFT');
  } finally { if(renderer)await act(async()=>renderer.unmount()); }
});

test('replacing display client cannot render even one frame from the previous mailbox', async () => {
  const oldWindow=globalThis.window, oldDocument=globalThis.document;
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();
  const snapshot={id:'approved-A',messageId:'mail-A',text:'MAILBOX_A_ONLY',nickname:'',linkUrl:null,assets:[]};
  const clientA={open:async()=>({receiverId:'receiver-A',epoch:'epoch-A',leaseMs:3000,pollIntervalMs:1000}),frame:async()=>({receiverId:'receiver-A',epoch:'epoch-A',revision:1,activation:1,leaseMs:3000,appearance,snapshot})};
  const clientB={open:async()=>({receiverId:'receiver-B',epoch:'epoch-B',leaseMs:3000,pollIntervalMs:1000}),frame:async()=>({receiverId:'receiver-B',epoch:'epoch-B',revision:1,activation:0,leaseMs:3000,appearance,snapshot:null})};
  let renderer;const seenByB=[];
  try {
    await act(async()=>{renderer=create(React.createElement(WindChimeLiveDisplay,{client:clientA}));});
    await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});
    assert(JSON.stringify(renderer.toJSON()).includes('MAILBOX_A_ONLY'));
    await act(async()=>{renderer.update(React.createElement(WindChimeLiveDisplay,{client:clientB,render:props=>{seenByB.push(props.snapshot.text);return null;}}));});
    assert.deepEqual(seenByB,[],'the new client render callback must never receive the old mailbox snapshot');
    assert.equal(renderer.toJSON(),null);
  } finally {
    if(renderer)await act(async()=>renderer.unmount());
    globalThis.window=oldWindow;globalThis.document=oldDocument;
  }
});

test('display forwards the polling interval and removes the previous timer when it changes', async t => {
  t.mock.timers.enable({apis:['setInterval','setTimeout']});
  const oldWindow=globalThis.window,oldDocument=globalThis.document;
  globalThis.window=new EventTarget();globalThis.document=new EventTarget();
  let opens=0,frames=0,renderer;
  const client={open:async()=>({receiverId:`r-${++opens}`,epoch:'epoch',leaseMs:3000,pollIntervalMs:1000}),frame:async receiverId=>{frames++;return {receiverId,epoch:'epoch',revision:1,activation:0,leaseMs:3000,appearance,snapshot:null};}};
  const advance=async ms=>{await act(async()=>{t.mock.timers.tick(ms);await new Promise(resolve=>setImmediate(resolve));});};
  try {
    await act(async()=>{renderer=create(React.createElement(WindChimeLiveDisplay,{client,pollIntervalMs:500}));});
    assert.equal(opens,1);assert.equal(renderer.toJSON(),null);
    await advance(499);assert.equal(frames,0);await advance(1);assert.equal(frames,1);
    await act(async()=>{renderer.update(React.createElement(WindChimeLiveDisplay,{client,pollIntervalMs:250}));});
    assert.equal(opens,2);assert.equal(renderer.toJSON(),null);
    await advance(249);assert.equal(frames,1);await advance(1);assert.equal(frames,2);
    await advance(250);assert.equal(frames,3,'the old 500ms interval must not remain subscribed');
    await act(async()=>renderer.unmount());renderer=null;await advance(1000);assert.equal(frames,3);
  } finally { if(renderer)await act(async()=>renderer.unmount());globalThis.window=oldWindow;globalThis.document=oldDocument; }
});

test('older sites allow private theme previews but never receive new appearance fields', async t => {
  const legacyAppearance = { ...appearance, layout: 'card' };
  for (const key of ['theme', 'accentColor', 'borderWidth', 'lineHeight', 'letterSpacing', 'maxWidth']) delete legacyAppearance[key];
  const calls = [], notifications = [];
  const state = { appearance: structuredClone(legacyAppearance) };
  const studio = { state, connected: true, pending: false, actWithResult: async command => { calls.push(command); return state; } };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AppearanceEditor, { studio, onDirtyChange: dirty => notifications.push(dirty) })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const save = () => renderer.root.findAllByType('button').find(node => node.children.join('') === '应用外观');
  const choose = async className => act(async () => renderer.root.findByProps({ className }).parent.props.onClick());
  assert.equal(save().props.disabled, true);
  assert(JSON.stringify(renderer.toJSON()).includes('此网站需要升级到风铃 0.8.0 才能保存新版外观。现在可以先预览。'));
  await choose('wc-appearance-layout-sample wc-appearance-layout-split');
  await choose('wc-appearance-theme-sample wc-appearance-theme-mia');
  const preview = renderer.root.findByType(WindChimeLiveCard).props;
  assert.equal(preview.appearance.theme, 'mia');
  assert.equal(preview.appearance.layout, 'split');
  assert.equal(notifications.at(-1), true);
  assert.equal(save().props.disabled, true, 'a local theme selection cannot claim that the server supports it');
  await act(async () => save().props.onClick());
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }));
  assert.deepEqual(calls, [], 'both click and form submission are blocked for an older server');
  assert.deepEqual(state.appearance, legacyAppearance, 'local previews never mutate the server response');
});

test('appearance presets keep the selected layout and text metrics private until explicitly applied', async t => {
  const initial = { ...appearance, layout: 'split', imageLayout: 'grid', fontSize: 38, padding: 21, lineHeight: 1.8, letterSpacing: 0.3, maxWidth: 900, animation: 'none' };
  const calls = [], notifications = [];
  const studio = { state: { appearance: structuredClone(initial) }, connected: true, pending: false, actWithResult: async command => {
    calls.push(structuredClone(command)); studio.state = { appearance: structuredClone(command.appearance) }; return studio.state;
  } };
  let renderer;
  await act(async () => { renderer = create(React.createElement(AppearanceEditor, { studio, onDirtyChange: dirty => notifications.push(dirty) })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  await act(async () => renderer.root.findByProps({ className: 'wc-appearance-theme-sample wc-appearance-theme-uliuli' }).parent.props.onClick());
  let preview = renderer.root.findByType(WindChimeLiveCard).props;
  assert.equal(preview.appearance.theme, 'uliuli');
  for (const key of ['layout', 'imageLayout', 'fontSize', 'padding', 'lineHeight', 'letterSpacing', 'maxWidth', 'animation']) assert.equal(preview.appearance[key], initial[key], key);
  assert.equal(calls.length, 0);
  assert.deepEqual(studio.state.appearance, initial);
  const font = renderer.root.findAllByType('label').find(node => node.children[0] === '字号').findByType('input');
  await act(async () => font.props.onChange({ target: { value: '42' } }));
  preview = renderer.root.findByType(WindChimeLiveCard).props;
  assert.equal(preview.appearance.fontSize, 42);
  const button = renderer.root.findAllByType('button').find(node => node.children.join('') === '应用外观');
  await act(async () => button.props.onClick());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].appearance.fontSize, 42);
  assert.equal(calls[0].appearance.layout, 'split');
  assert.equal(notifications.at(-1), false);
});

test('appearance preview falls back to window resize when ResizeObserver is unavailable', async () => {
  const oldWindow = globalThis.window, oldObserver = globalThis.ResizeObserver;
  globalThis.window = new EventTarget();
  globalThis.ResizeObserver = undefined;
  let renderer, width = 640;
  try {
    const studio = { state: { appearance }, connected: true, pending: false, actWithResult: async () => null };
    await act(async () => { renderer = create(React.createElement(AppearanceEditor, { studio, onDirtyChange() {} }), {
      createNodeMock: element => element.props.className === 'wc-appearance-viewport' ? { getBoundingClientRect: () => ({ width }) } : null,
    }); });
    const canvas = () => renderer.root.findByProps({ className: 'wc-appearance-canvas' });
    assert.equal(canvas().props.style.transform, 'scale(0.5)');
    width = 320;
    await act(async () => globalThis.window.dispatchEvent(new Event('resize')));
    assert.equal(canvas().props.style.transform, 'scale(0.25)');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.window = oldWindow;
    globalThis.ResizeObserver = oldObserver;
  }
});

test('appearance preview scales its widest card and reserves scroll space for tall content', async () => {
  const oldObserver = globalThis.ResizeObserver;
  const observers = [];
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.nodes = []; this.disconnected = false; observers.push(this); }
    observe(node) { this.nodes.push(node); }
    disconnect() { this.disconnected = true; }
  };
  let renderer;
  const viewportNode = { clientWidth: 800, getBoundingClientRect: () => ({ width: 800 }) };
  const contentNode = { scrollHeight: 480 };
  try {
    const studio = { state: { appearance: { ...appearance, maxWidth: 1920 } }, connected: true, pending: false, actWithResult: async () => null };
    await act(async () => { renderer = create(React.createElement(AppearanceEditor, { studio, onDirtyChange() {} }), {
      createNodeMock: element => element.props.className === 'wc-appearance-viewport' ? viewportNode : element.props.className === 'wc-appearance-preview-content' ? contentNode : null,
    }); });
    const canvas = () => renderer.root.findByProps({ className: 'wc-appearance-canvas' });
    assert.equal(canvas().props.style.width, 2000, '1920px card receives its full width plus two 40px margins');
    assert.equal(canvas().props.style.transform, 'scale(0.4)');
    assert.equal(canvas().props.style.height, 1125, 'the initial canvas is at least 16:9');
    assert.equal(observers.at(-1).nodes.length, 2, 'viewport and intrinsic content are observed');
    const input = label => renderer.root.findAllByType('label').find(node => node.children[0] === label).findByType('input');
    await act(async () => { input('字号').props.onChange({ target: { value: '96' } }); input('最大宽度').props.onChange({ target: { value: '280' } }); });
    assert.equal(canvas().props.style.width, 1280, 'narrow cards retain the original canvas size');
    contentNode.scrollHeight = 4200;
    await act(async () => observers.at(-1).callback());
    assert.equal(canvas().props.style.height, 4280, 'the full card height and both margins are reserved');
    assert.equal(renderer.root.findByProps({ className: 'wc-appearance-scroll-space' }).props.style.height, 2675);
    assert.equal(renderer.root.findByProps({ className: 'wc-appearance-viewport' }).props.tabIndex, 0, 'overflow can be reached with keyboard scrolling');
    assert(JSON.stringify(renderer.toJSON()).includes('等比例预览 · 可上下滚动'));
    assert(observers.slice(0, -1).every(observer => observer.disconnected), 'replaced observers are disconnected');
    await act(async () => renderer.unmount()); renderer = null;
    assert(observers.every(observer => observer.disconnected), 'unmount releases the final observer');
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    globalThis.ResizeObserver = oldObserver;
  }
});
