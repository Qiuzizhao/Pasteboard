'use strict';
// 验证鉴权边界：Basic Auth 只保护页面，/api/* 只认应用令牌
// 使用方式: PB_AUTH_PASS= PB_TOKEN= node verify-auth.js
const https = require('https');

const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';
const AUTH_PASS = process.env.PB_AUTH_PASS;
const TOKEN = process.env.PB_TOKEN;
if (!AUTH_PASS || !TOKEN) { console.error('缺少 PB_AUTH_PASS / PB_TOKEN'); process.exit(1); }
const AUTH = 'Basic ' + Buffer.from('admin:' + AUTH_PASS).toString('base64');

function req(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: DOMAIN, port: 443, path, method: opts.method || 'GET',
      servername: DOMAIN, rejectUnauthorized: false,
      headers: opts.headers || {},
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 120) }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  let r;
  r = await req('/api/health');
  console.log('1. /api/health 无任何凭据（应 200，API 不再套 Basic Auth）:', r.status);

  r = await req('/api/clipboard');
  console.log('2. /api/clipboard 无令牌（应 401 应用层 JSON）:', r.status, r.body);

  r = await req('/api/clipboard', { headers: { 'X-Clipboard-Token': TOKEN } });
  console.log('3. /api/clipboard 带令牌（应 200）:', r.status);

  r = await req('/');
  console.log('4. 页面无 Basic Auth（应 401）:', r.status);

  r = await req('/', { headers: { Authorization: AUTH } });
  console.log('5. 页面带 Basic Auth（应 200，含网页剪贴板）:', r.status, r.body.includes('网页剪贴板'));
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
