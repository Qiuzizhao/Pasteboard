'use strict';
// 用 DOM 桩模拟页面脚本，复现"粘贴带链接内容"流程，定位运行时错误
const fs = require('fs');

// ---------- 最小 DOM 桩 ----------
class El {
  constructor(id) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.hidden = false;
    this.style = {};
    this.dataset = {};
    this.listeners = {};
    this.children = [];
  }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  classList = { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } };
  appendChild(c) { this.children.push(c); return c; }
  remove() {}
  setAttribute() {}
  removeAttribute() {}
  focus() {}
}

const els = {};
const IDs = ['clip', 'status', 'dot', 'clipImage', 'imageMeta', 'tipText', 'loginModal', 'tokenInput', 'tokenOk', 'tokenCancel',
  'banner', 'bannerLoad', 'imageView', 'chars', 'lastSaved', 'pasteBtn', 'copyBtn', 'copyImageBtn', 'downloadBtn',
  'lightbox', 'lightboxImg', 'lightboxClose', 'clearBtn', 'searchInput', 'clearHistBtn', 'histCount', 'history', 'toast'];
for (const id of IDs) els[id] = new El(id);

global.document = {
  getElementById: (id) => els[id] || (els[id] = new El(id)),
  createElement: (tag) => new El(tag),
  addEventListener: () => {},
  hidden: false,
  body: new El('body'),
};
global.window = { addEventListener: () => {}, innerWidth: 1280 };
// navigator 在 Node 里是只读全局，直接用内置的（userAgent/maxTouchPoints 已存在）
global.localStorage = { getItem: () => null, setItem: () => {} };
global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ type: 'text', content: '', version: 0, updated_at: 0, items: [] }), headers: {} });
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.Blob = class { constructor(p) { this.type = (p && p[0] && p[0].type) || ''; this.size = 10; } };
global.File = class { constructor() {} };
global.createImageBitmap = async () => ({ width: 100, height: 100, close() {} });
global.confirm = () => true;
global.ClipboardItem = class { constructor(o) { this.o = o; } };
global.alert = () => {};

// ---------- 加载页面脚本 ----------
const html = fs.readFileSync('app/static/index.html', 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const fn = new Function(script);
try {
  fn();
  console.log('✅ 脚本加载无异常');
} catch (e) {
  console.log('❌ 脚本加载即报错:', e.message);
  process.exit(1);
}

// ---------- 模拟粘贴 ----------
const pasteHandlers = els['clip'].listeners['paste'] || []; // 全局 paste 挂在 document 上，这里取不到
// 全局 paste 挂在 document.addEventListener —— 我们 stub 掉了，改成手动捕获
// 重新加载一次，捕获 document 上的 paste 处理器
global.document.addEventListener = (ev, fn) => { if (ev === 'paste') global.__pasteHandlers = (global.__pasteHandlers || []).concat(fn); };

async function simulate(target, formats, withImage) {
  global.__pasteHandlers = [];
  els.clip.value = ''; // 每个场景重置输入框
  try { new Function(script)(); } catch (e) { console.log('重载失败:', e.message); }
  const ev = {
    target,
    clipboardData: {
      items: withImage ? [{ type: 'image/png', getAsFile: () => ({ type: 'image/png', name: 'x.png' }) }] : [],
      files: [],
      getData: (t) => (typeof formats === 'string' ? (t === 'text/plain' ? formats : '') : (formats[t] || '')),
    },
    preventDefault() { this._prevented = true; },
  };
  try {
    for (const h of global.__pasteHandlers || []) await h(ev);
    return { ok: true, prevented: ev._prevented, clipValue: els.clip.value };
  } catch (e) {
    return { ok: false, error: e.message, stack: e.stack };
  }
}

(async () => {
  console.log('--- 场景1：点击页面空白处粘贴纯文本 ---');
  let r = await simulate(global.document.body, '普通文字');
  console.log(JSON.stringify(r));

  console.log('--- 场景2：点击页面空白处粘贴带链接文本 ---');
  r = await simulate(global.document.body, '看这个 https://example.com/path?x=1 不错');
  console.log(JSON.stringify(r));

  console.log('--- 场景3：粘贴单条 URL ---');
  r = await simulate(global.document.body, 'https://example.com');
  console.log(JSON.stringify(r));

  console.log('--- 场景4：焦点在输入框内粘贴带链接文本（走默认行为）---');
  r = await simulate(els.clip, '看这个 https://example.com 不错');
  console.log(JSON.stringify(r));

  console.log('--- 场景5：剪贴板同时有文字+图片（带预览图的链接）→ 应粘贴文字 ---');
  r = await simulate(global.document.body, 'https://example.com/article', true);
  console.log(JSON.stringify(r));

  console.log('--- 场景6：剪贴板只有图片 → 应走图片上传 ---');
  r = await simulate(global.document.body, '', true);
  console.log(JSON.stringify(r));

  console.log('--- 场景7：内容结尾带换行符（页面空白处粘贴）---');
  r = await simulate(global.document.body, '第一行\n第二行\n');
  console.log('clipValue:', JSON.stringify(r.clipValue), '| 结尾是\\n:', r.clipValue.endsWith('\n'));

  console.log('--- 场景8：内容只有换行符 ---');
  r = await simulate(global.document.body, '\n\n');
  console.log('clipValue:', JSON.stringify(r.clipValue), '| 长度:', r.clipValue.length);

  console.log('--- 场景9：单个 URL + 尾随换行 ---');
  r = await simulate(global.document.body, 'https://example.com\n');
  console.log('clipValue:', JSON.stringify(r.clipValue));

  console.log('--- 场景10：剪贴板只提供 text/html（带尾随换行）→ 应粘贴 ---');
  r = await simulate(global.document.body, { 'text/html': '<div>第一行</div><div>第二行</div>\n' });
  console.log('clipValue:', JSON.stringify(r.clipValue));

  console.log('--- 场景11：只提供 text/html 富文本 → 转纯文本粘贴 ---');
  r = await simulate(global.document.body, { 'text/html': '<p>链接 <a href="https://example.com">点我</a> 和 <b>粗体</b></p>' });
  console.log('clipValue:', JSON.stringify(r.clipValue));

  console.log('--- 场景12：同时有 text/plain + text/html → 优先 text/plain ---');
  r = await simulate(global.document.body, { 'text/plain': '纯文本版本', 'text/html': '<b>HTML版本</b>' });
  console.log('clipValue:', JSON.stringify(r.clipValue));
})();
