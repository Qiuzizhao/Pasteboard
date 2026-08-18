'use strict';
// 线上验证（Node TLS，绕过本机 schannel 问题）
// 使用方式: PB_AUTH_PASS=登录密码 PB_TOKEN=访问令牌 node verify.js
const https = require('https');

const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';
const AUTH_PASS = process.env.PB_AUTH_PASS;
const TOKEN = process.env.PB_TOKEN;

if (!AUTH_PASS || !TOKEN) {
  console.error('缺少环境变量 PB_AUTH_PASS（Caddy 登录密码）或 PB_TOKEN（访问令牌）');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from('admin:' + AUTH_PASS).toString('base64');

function request(host, path, opts = {}, body) {
  return new Promise((resolve, reject) => {
    const mod = opts.insecure ? https : https;
    const req = mod.request({
      host, port: 443, path, method: opts.method || 'GET',
      servername: host,
      rejectUnauthorized: false,
      headers: Object.assign({ 'User-Agent': 'verify' }, opts.headers || {}),
    }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: b.slice(0, 300) }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  console.log('=== 1. 无凭据访问（期望 401） ===');
  console.log(JSON.stringify(await request(DOMAIN, '/api/health')));

  console.log('=== 2. Basic Auth 访问 health（期望 200 ok） ===');
  console.log(JSON.stringify(await request(DOMAIN, '/api/health', { headers: { Authorization: AUTH } })));

  console.log('=== 3. 带令牌读剪贴板 ===');
  console.log(JSON.stringify(await request(DOMAIN, '/api/clipboard', { headers: { Authorization: AUTH, 'X-Clipboard-Token': TOKEN } })));

  console.log('=== 4. 写入测试文字 ===');
  console.log(JSON.stringify(await request(DOMAIN, '/api/clipboard', {
    method: 'PUT',
    headers: { Authorization: AUTH, 'X-Clipboard-Token': TOKEN, 'Content-Type': 'application/json' },
  }, { content: '线上部署成功 🎉 2026-08-18' })));

  console.log('=== 5. 读取首页 HTML（期望包含 剪贴板） ===');
  const page = await request(DOMAIN, '/', { headers: { Authorization: AUTH } });
  console.log('status=' + page.status + ' 含标题: ' + page.body.includes('网页剪贴板') + ' 含图片支持: ' + page.body.includes('复制图片'));
})().catch((e) => { console.error('验证失败:', e.message); process.exit(1); });
