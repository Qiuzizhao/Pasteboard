'use strict';
// 清空线上剪贴板数据（清空主剪贴板 + 清空历史）
// 使用方式: PB_AUTH_PASS= PB_TOKEN= node clear-data.js
const https = require('https');

const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';
const AUTH_PASS = process.env.PB_AUTH_PASS;
const TOKEN = process.env.PB_TOKEN;
if (!AUTH_PASS || !TOKEN) { console.error('缺少 PB_AUTH_PASS / PB_TOKEN'); process.exit(1); }
const AUTH = 'Basic ' + Buffer.from('admin:' + AUTH_PASS).toString('base64');
const H = { Authorization: AUTH, 'X-Clipboard-Token': TOKEN, 'Content-Type': 'application/json' };

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({ host: DOMAIN, port: 443, path, method, servername: DOMAIN, rejectUnauthorized: false, headers: H }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 200) }));
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

(async () => {
  console.log('清空主剪贴板:', JSON.stringify(await req('PUT', '/api/clipboard', { content: '' })));
  console.log('清空历史:', JSON.stringify(await req('DELETE', '/api/history')));
  console.log('最终状态:', JSON.stringify(await req('GET', '/api/clipboard')));
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
