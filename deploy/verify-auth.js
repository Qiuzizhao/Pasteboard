'use strict';
// 验证认证：页面公开加载，/api/* 由应用令牌保护
// 使用方式: PB_TOKEN= node verify-auth.js
const https = require('https');

const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';
const TOKEN = process.env.PB_TOKEN;
if (!TOKEN) { console.error('缺少 PB_TOKEN'); process.exit(1); }

function req(path, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const r = https.request({
      host: DOMAIN, port: 443, path, method: opts.method || 'GET',
      servername: DOMAIN, rejectUnauthorized: false,
      headers: opts.headers || {},
    }, (res) => {
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
  let r;
  r = await req('/');
  console.log('1. 页面无任何凭据（应 200，不再有 Basic Auth 弹窗）:', r.status, '| 含标题:', r.body.includes('网页剪贴板'));

  r = await req('/api/clipboard');
  console.log('2. /api/clipboard 无令牌（应 401 应用层）:', r.status, r.body);

  r = await req('/api/clipboard', { headers: { 'X-Clipboard-Token': TOKEN } });
  console.log('3. /api/clipboard 带令牌（应 200）:', r.status);

  r = await req('/api/clipboard', {
    method: 'PUT',
    headers: { 'X-Clipboard-Token': TOKEN, 'Content-Type': 'application/json' },
  }, { content: 'Basic Auth 已移除，移动端不再弹窗 ✅' });
  console.log('4. 写入测试（应 200）:', r.status, r.body);

  r = await req('/api/history', { headers: { 'X-Clipboard-Token': TOKEN } });
  console.log('5. 历史（应含测试条目）:', r.status);

  // 清理测试数据
  await req('/api/clipboard', {
    method: 'PUT',
    headers: { 'X-Clipboard-Token': TOKEN, 'Content-Type': 'application/json' },
  }, { content: '' });
  await req('/api/history', { method: 'DELETE', headers: { 'X-Clipboard-Token': TOKEN } });
  console.log('6. 测试数据已清理');
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
