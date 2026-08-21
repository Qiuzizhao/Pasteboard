'use strict';
// 提取线上页面中粘贴处理器的真实代码
const https = require('https');
https.get({ host: 'clipboard.qiuzizhao.com', port: 443, path: '/', servername: 'clipboard.qiuzizhao.com', rejectUnauthorized: false }, (r) => {
  let b = '';
  r.on('data', (d) => { b += d; });
  r.on('end', () => {
    const m = b.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) { console.log('无 script'); return; }
    const lines = m[1].split('\n');
    const start = lines.findIndex((l) => l.includes("addEventListener('paste'"));
    if (start === -1) { console.log('未找到 paste 处理器'); return; }
    console.log('=== 线上 paste 处理器（' + start + ' 行起）===');
    console.log(lines.slice(start - 2, start + 40).join('\n'));
  });
}).on('error', (e) => { console.error('失败:', e.message); process.exit(1); });
