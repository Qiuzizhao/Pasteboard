'use strict';
// 诊断 308：确认重定向来源 + 源站直连 HTTPS 是否正常
// 使用方式: PB_HOST=服务器IP node diag308.js
const https = require('https');

const ORIGIN = process.env.PB_HOST;
if (!ORIGIN) {
  console.error('缺少环境变量 PB_HOST（服务器 IP）');
  process.exit(1);
}

function req(opts) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => resolve({ status: res.statusCode, loc: res.headers.location || '-', body: b.slice(0, 120) }));
    });
    r.on('error', reject);
    r.end();
  });
}

(async () => {
  // 1. 经 CF 的 https 请求：看 Location 指向哪里
  let r = await req({
    host: 'clipboard.qiuzizhao.com', port: 443, path: '/api/health',
    servername: 'clipboard.qiuzizhao.com', rejectUnauthorized: false,
  });
  console.log('经CF(域名): status=' + r.status + ' location=' + r.loc);

  // 2. 源站直连 443：如果返回 200/401 而不是 308，说明源站 HTTPS 正常，问题在 CF 模式
  r = await req({
    host: ORIGIN, port: 443, path: '/api/health',
    servername: 'clipboard.qiuzizhao.com', rejectUnauthorized: false,
    headers: { Host: 'clipboard.qiuzizhao.com' },
  });
  console.log('源站直连443: status=' + r.status + ' location=' + r.loc + ' body=' + r.body);

  // 3. 源站直连 80：应该 308 到 https
  r = await new Promise((resolve, reject) => {
    const http = require('http');
    const q = http.request({ host: ORIGIN, port: 80, path: '/api/health', headers: { Host: 'clipboard.qiuzizhao.com' } }, (res) => {
      res.resume();
      resolve({ status: res.statusCode, loc: res.headers.location || '-' });
    });
    q.on('error', reject);
    q.end();
  });
  console.log('源站直连80: status=' + r.status + ' location=' + r.loc);
})().catch((e) => { console.error('诊断失败:', e.message); process.exit(1); });
