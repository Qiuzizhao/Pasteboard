'use strict';
// 验证优化版上线（公网路径）
const https = require('https');
const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';
const TOKEN = process.env.PB_TOKEN;

function get(path, headers) {
  return new Promise((resolve, reject) => {
    https.get({ host: DOMAIN, port: 443, path, servername: DOMAIN, rejectUnauthorized: false, headers: headers || {} }, (r) => {
      let b = '';
      r.on('data', (d) => { b += d; });
      r.on('end', () => resolve({ status: r.statusCode, type: r.headers['content-type'] || '', len: b.length, body: b }));
    }).on('error', reject);
  });
}

(async () => {
  let r;
  r = await get('/');
  console.log('1. 首页:', r.status, '| searchInput:', r.body.includes('searchInput'), '| lightbox:', r.body.includes('id="lightbox"'), '| SW注册:', r.body.includes('serviceWorker'), '| 压缩:', r.body.includes('compressImage'));

  r = await get('/manifest.webmanifest');
  console.log('2. manifest:', r.status, r.type);

  r = await get('/sw.js');
  console.log('3. sw.js:', r.status, r.type);

  r = await get('/icons/icon-192.png');
  console.log('4. icon-192:', r.status, r.type, r.len + 'B');

  r = await get('/icons/icon-512.png');
  console.log('5. icon-512:', r.status, r.type, r.len + 'B');

  r = await get('/api/clipboard', { 'X-Clipboard-Token': TOKEN });
  console.log('6. API 读剪贴板:', r.status, r.body.slice(0, 90));

  r = await get('/api/history', { 'X-Clipboard-Token': TOKEN });
  console.log('7. 历史:', r.status, r.body.slice(0, 90));
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
