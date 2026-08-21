'use strict';

/**
 * Pasteboard — 个人网页剪贴板后端（Node.js 零依赖）
 * 支持文字与图片：
 *   文字/元数据 → state.json（异步合并写入）；图片文件 → data/images/ 目录（内存 LRU 缓存）
 *
 * 环境变量：
 *   CLIPBOARD_TOKEN      访问令牌（必填，多设备共用同一令牌）
 *   CLIPBOARD_DATA_DIR   数据目录（默认 ./data）
 *   CLIPBOARD_HISTORY_LIMIT  历史记录条数上限（默认 200）
 *   PORT                 监听端口（默认 8000）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8000);
const DATA_DIR = process.env.CLIPBOARD_DATA_DIR || path.join(__dirname, 'data');
const TOKEN = process.env.CLIPBOARD_TOKEN || '';
const HISTORY_LIMIT = Number(process.env.CLIPBOARD_HISTORY_LIMIT || 200);
const STATIC_DIR = path.join(__dirname, 'static');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const MAX_TEXT_BODY = 1024 * 1024;        // 文字请求 1 MB
const MAX_IMAGE_BODY = 12 * 1024 * 1024;  // 图片上传 12 MB
const SAVE_DEBOUNCE_MS = 250;             // state.json 异步合并写入间隔
const IMAGE_CACHE_MAX_BYTES = 64 * 1024 * 1024; // 图片内存缓存上限 64MB

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// ---------------------------------------------------------------------------
// 存储：state.json（异步写入）+ images/ 目录（LRU 缓存）
// ---------------------------------------------------------------------------

let state = {
  clipboard: { type: 'text', content: '', image_id: null },
  version: 0,
  updated_at: 0,
  history: [],   // {id, type: 'text'|'image', content?, image_id?, created_at}
  images: {},    // image_id -> {mime, size}
  next_id: 1,
};

function loadState() {
  let parsed = null;
  // 依次尝试：主文件 → 三代备份（防止误删/误写后无法回退）
  const candidates = [STATE_FILE, STATE_FILE + '.bak', STATE_FILE + '.bak.1', STATE_FILE + '.bak.2'];
  for (const f of candidates) {
    try {
      parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      break;
    } catch (_) { /* 尝试下一份 */ }
  }
  if (!parsed) return;
  try {
    state.clipboard = parsed.clipboard && typeof parsed.clipboard === 'object'
      ? {
          type: parsed.clipboard.type === 'image' ? 'image' : 'text',
          content: typeof parsed.clipboard.content === 'string' ? parsed.clipboard.content : '',
          image_id: parsed.clipboard.image_id || null,
        }
      : {
          type: 'text',
          content: typeof parsed.content === 'string' ? parsed.content : '',
          image_id: null,
        };
    state.version = Number.isInteger(parsed.version) ? parsed.version : 0;
    state.updated_at = typeof parsed.updated_at === 'number' ? parsed.updated_at : 0;
    state.history = Array.isArray(parsed.history)
      ? parsed.history.map((h) => ({
          id: Number(h.id),
          type: h.type === 'image' ? 'image' : 'text',
          content: typeof h.content === 'string' ? h.content : '',
          image_id: h.image_id || null,
          created_at: typeof h.created_at === 'number' ? h.created_at : 0,
        }))
      : [];
    state.images = parsed.images && typeof parsed.images === 'object' ? parsed.images : {};
    state.next_id = Number.isInteger(parsed.next_id) ? parsed.next_id : 1;
  } catch (_) {
    // 首次启动，使用默认空状态
  }
}

// 同步写入（启动 GC、退出前落盘用）
// 多代备份：每次写入前把 state.json 轮转到 .bak，再 .bak → .bak.1 → .bak.2
// 共保留 3 份历史状态，误删/误写后可回退多步
function backupState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    try { fs.copyFileSync(STATE_FILE + '.bak.1', STATE_FILE + '.bak.2'); } catch (_) { /* 无更早备份 */ }
    try { fs.copyFileSync(STATE_FILE + '.bak', STATE_FILE + '.bak.1'); } catch (_) { /* 无上一份 */ }
    fs.copyFileSync(STATE_FILE, STATE_FILE + '.bak');
  } catch (_) { /* 忽略 */ }
}

function saveStateSync() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backupState();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state), 'utf8');
  fs.renameSync(tmp, STATE_FILE);
}

// 异步合并写入：快速连续变更只落盘一次，避免每次请求同步阻塞
let saveTimer = null;
let saveBusy = false;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}
function flushSave() {
  if (saveBusy) { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS); return; }
  saveBusy = true;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  backupState(); // 写入前保留上一次状态（state.json.bak）
  const tmp = STATE_FILE + '.tmp';
  const data = JSON.stringify(state);
  fs.writeFile(tmp, data, 'utf8', (err) => {
    if (err) { saveBusy = false; return; }
    fs.rename(tmp, STATE_FILE, () => { saveBusy = false; });
  });
}

process.on('SIGTERM', () => {
  clearTimeout(saveTimer);
  saveStateSync();
  process.exit(0);
});
process.on('SIGINT', () => {
  clearTimeout(saveTimer);
  saveStateSync();
  process.exit(0);
});

// ---------------------------------------------------------------------------
// 图片：文件 + 内存 LRU 缓存
// ---------------------------------------------------------------------------

const imageCache = new Map(); // image_id -> Buffer
let imageCacheBytes = 0;

function getImageFile(imageId, info) {
  const hit = imageCache.get(imageId);
  if (hit) {
    imageCache.delete(imageId); // 刷新最近使用
    imageCache.set(imageId, hit);
    return hit;
  }
  const fp = path.join(IMAGES_DIR, imageId + '.' + (MIME_EXT[info.mime] || 'bin'));
  const buf = fs.readFileSync(fp); // 文件不存在会抛错
  imageCache.set(imageId, buf);
  imageCacheBytes += buf.length;
  while (imageCacheBytes > IMAGE_CACHE_MAX_BYTES && imageCache.size > 1) {
    const oldestKey = imageCache.keys().next().value;
    imageCacheBytes -= imageCache.get(oldestKey).length;
    imageCache.delete(oldestKey);
  }
  return buf;
}

function dropImageCache(imageId) {
  const buf = imageCache.get(imageId);
  if (buf) { imageCacheBytes -= buf.length; imageCache.delete(imageId); }
}

// 删除图片文件 + 元数据 + 缓存
function deleteImageFile(imageId) {
  const info = state.images && state.images[imageId];
  if (!info) return;
  try {
    fs.unlinkSync(path.join(IMAGES_DIR, imageId + '.' + (MIME_EXT[info.mime] || 'bin')));
  } catch (_) { /* 文件可能已不存在 */ }
  dropImageCache(imageId);
  delete state.images[imageId];
}

// 启动时清理孤儿图片（未被剪贴板/历史引用的文件），返回是否有清理动作
function gcImages() {
  if (!fs.existsSync(IMAGES_DIR)) return false;
  const referenced = new Set();
  if (state.clipboard.type === 'image' && state.clipboard.image_id) {
    referenced.add(state.clipboard.image_id);
  }
  for (const h of state.history) {
    if (h.type === 'image' && h.image_id) referenced.add(h.image_id);
  }
  let changed = false;
  for (const id of Object.keys(state.images)) {
    if (!referenced.has(id)) {
      const info = state.images[id];
      try {
        fs.unlinkSync(path.join(IMAGES_DIR, id + '.' + (MIME_EXT[info.mime] || 'bin')));
      } catch (_) { /* 忽略 */ }
      dropImageCache(id);
      delete state.images[id];
      changed = true;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------

function sendJson(res, status, obj, etag) {
  const body = JSON.stringify(obj);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  };
  if (etag) headers.ETag = etag;
  res.writeHead(status, headers);
  res.end(body);
}

function sendText(res, status, text, mime) {
  const body = Buffer.from(text, 'utf8');
  res.writeHead(status, {
    'Content-Type': mime || 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function readBody(req, limit = MAX_TEXT_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!TOKEN) return true; // 未配置令牌时放行（本地开发用，生产必须配置）
  return req.headers['x-clipboard-token'] === TOKEN;
}

// ---------------------------------------------------------------------------
// API 路由
// ---------------------------------------------------------------------------

async function handleApi(req, res, url) {
  // 健康检查（不校验令牌，供 Caddy / docker healthcheck 使用）
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true });
  }

  if (!checkAuth(req)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  // 获取当前剪贴板（支持 ETag 条件请求，无变化返回 304）
  if (req.method === 'GET' && url.pathname === '/api/clipboard') {
    const etag = '"v' + state.version + '"';
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    return sendJson(res, 200, {
      type: state.clipboard.type,
      content: state.clipboard.content,
      image_id: state.clipboard.image_id,
      version: state.version,
      updated_at: state.updated_at,
    }, etag);
  }

  // 设置当前剪贴板（写入历史）
  if (req.method === 'PUT' && url.pathname === '/api/clipboard') {
    let body;
    try {
      body = JSON.parse((await readBody(req)).toString('utf8'));
    } catch (_) {
      return sendJson(res, 400, { error: 'invalid json' });
    }
    const now = Date.now() / 1000;

    let type, content, imageId;
    if (body && body.type === 'image') {
      if (typeof body.image_id !== 'string' || !state.images[body.image_id]) {
        return sendJson(res, 400, { error: 'unknown image' });
      }
      type = 'image';
      content = '';
      imageId = body.image_id;
    } else {
      type = 'text';
      content = typeof body.content === 'string' ? body.content : '';
      imageId = null;
    }

    state.version += 1;
    state.clipboard = { type, content, image_id: imageId };
    state.updated_at = now;

    // 历史去重：文字按内容、图片按 id；空文字不入历史
    const last = state.history[0];
    let record = false;
    if (type === 'text') {
      record = content !== '' && (!last || last.type !== 'text' || last.content !== content);
    } else {
      record = !last || last.type !== 'image' || last.image_id !== imageId;
    }
    if (record) {
      state.history.unshift({ id: state.next_id++, type, content, image_id: imageId, created_at: now });
    }
    if (state.history.length > HISTORY_LIMIT) {
      state.history.length = HISTORY_LIMIT; // 超限图片文件由下次启动时的 gcImages 清理
    }
    scheduleSave();
    return sendJson(res, 200, {
      type, content, image_id: imageId,
      version: state.version, updated_at: now,
    });
  }

  // 上传图片（raw body，Content-Type 必须是支持的图片类型）
  if (req.method === 'POST' && url.pathname === '/api/images') {
    const ctype = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    const ext = MIME_EXT[ctype];
    if (!ext) {
      return sendJson(res, 415, { error: 'unsupported image type, only png/jpeg/gif/webp' });
    }
    let buf;
    try {
      buf = await readBody(req, MAX_IMAGE_BODY);
    } catch (_) {
      return sendJson(res, 413, { error: 'image too large (max 12MB)' });
    }
    if (!buf.length) {
      return sendJson(res, 400, { error: 'empty body' });
    }
    const id = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMAGES_DIR, id + '.' + ext), buf);
    state.images = state.images || {};
    state.images[id] = { mime: ctype, size: buf.length };
    scheduleSave();
    return sendJson(res, 200, { id, mime: ctype, size: buf.length });
  }

  // 读取图片（走内存 LRU 缓存）
  const imgMatch = url.pathname.match(/^\/api\/images\/([A-Za-z0-9-]+)$/);
  if (req.method === 'GET' && imgMatch) {
    const id = imgMatch[1];
    const info = state.images && state.images[id];
    if (!info) return sendJson(res, 404, { error: 'not found' });
    try {
      const data = getImageFile(id, info);
      res.writeHead(200, {
        'Content-Type': info.mime,
        'Content-Length': data.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(data);
      return;
    } catch (_) {
      return sendJson(res, 404, { error: 'not found' });
    }
  }

  // 历史记录列表（新的在前）
  if (req.method === 'GET' && url.pathname === '/api/history') {
    const items = state.history.map((it) => ({
      id: it.id,
      type: it.type,
      content: it.content,
      image_id: it.image_id,
      created_at: it.created_at,
      char_count: it.type === 'text' ? it.content.length : 0,
    }));
    return sendJson(res, 200, { items });
  }

  // 清空历史
  if (req.method === 'DELETE' && url.pathname === '/api/history') {
    for (const it of state.history) {
      if (it.type === 'image' && it.image_id &&
          !(state.clipboard.type === 'image' && state.clipboard.image_id === it.image_id)) {
        deleteImageFile(it.image_id);
      }
    }
    state.history = [];
    scheduleSave();
    return sendJson(res, 200, { ok: true });
  }

  // 删除单条历史
  const delMatch = url.pathname.match(/^\/api\/history\/(\d+)$/);
  if (req.method === 'DELETE' && delMatch) {
    const id = Number(delMatch[1]);
    const item = state.history.find((it) => it.id === id);
    state.history = state.history.filter((it) => it.id !== id);
    if (item && item.type === 'image' && item.image_id &&
        !(state.clipboard.type === 'image' && state.clipboard.image_id === item.image_id)) {
      deleteImageFile(item.image_id);
    }
    scheduleSave();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not found' });
}

// ---------------------------------------------------------------------------
// 静态文件（前端单页）
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(STATIC_DIR, rel));
  if (!filePath.startsWith(STATIC_DIR)) {
    return sendText(res, 403, 'forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) return sendText(res, 404, 'not found');
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

// ---------------------------------------------------------------------------
// 启动
// ---------------------------------------------------------------------------

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((e) => {
      console.error('API error:', e);
      sendJson(res, 500, { error: 'internal error' });
    });
    return;
  }
  if (req.method === 'GET') {
    serveStatic(res, url.pathname);
    return;
  }
  sendJson(res, 405, { error: 'method not allowed' });
});

if (!fs.existsSync(path.join(STATIC_DIR, 'index.html'))) {
  console.error('缺少 app/static/index.html，无法启动');
  process.exit(1);
}

loadState();
if (gcImages()) saveStateSync(); // 清理孤儿图片并持久化
server.listen(PORT, () => {
  console.log(`Pasteboard 已启动: http://0.0.0.0:${PORT}`);
  console.log(`数据目录: ${DATA_DIR}`);
  if (!TOKEN) {
    console.warn('警告: 未设置 CLIPBOARD_TOKEN，任何能访问到本服务的人都可以读写！');
  }
});
