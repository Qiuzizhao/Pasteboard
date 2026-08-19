'use strict';
// 重写 clipboard vhost：80 直接服务（无 301 循环）+ 443 TLS
const { Client } = require('ssh2');
const HOST = process.env.PB_HOST, PORT = Number(process.env.PB_PORT || 22),
      USER = process.env.PB_USER, PASSWORD = process.env.PB_PASSWORD;
const conn = new Client();
conn.on('ready', () => {
  const run = (cmd) => new Promise((res) => {
    conn.exec('bash -lc ' + JSON.stringify(cmd), (err, s) => {
      if (err) return res('ERR: ' + err.message);
      let out = '';
      s.on('close', () => res(out.trim()));
      s.on('data', (d) => { out += d.toString(); });
      s.stderr.on('data', (d) => { out += d.toString(); });
    });
  });
  (async () => {
    const proxy = [
      '    client_max_body_size 20m;',
      '    location / {',
      '        proxy_pass http://127.0.0.1:8001;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Upgrade $http_upgrade;',
      '        proxy_set_header Connection "upgrade";',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_connect_timeout 15s;',
      '        proxy_send_timeout 300s;',
      '        proxy_read_timeout 300s;',
      '    }',
    ].join('\n');
    const vhost = [
      '# clipboard.qiuzizhao.com - 网页剪贴板（nginx 前端）',
      '# 80 端口直接服务（兼容 Cloudflare Flexible 回源），443 提供 TLS',
      'server {',
      '    listen 80;',
      '    server_name clipboard.qiuzizhao.com;',
      proxy,
      '}',
      '',
      'server {',
      '    listen 443 ssl http2;',
      '    server_name clipboard.qiuzizhao.com;',
      '    ssl_certificate /etc/letsencrypt/live/clipboard.qiuzizhao.com/fullchain.pem;',
      '    ssl_certificate_key /etc/letsencrypt/live/clipboard.qiuzizhao.com/privkey.pem;',
      proxy,
      '}',
      '',
    ].join('\n');
    const b64 = Buffer.from(vhost, 'utf8').toString('base64');
    console.log(await run('echo ' + b64 + ' | base64 -d | sudo tee /etc/nginx/sites-available/clipboard > /dev/null && sudo nginx -t 2>&1 | tail -1 && sudo systemctl reload nginx 2>&1 && echo RELOAD_OK'));

    await new Promise((r) => setTimeout(r, 1500));
    console.log('clipboard 80(本地):', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" http://127.0.0.1/; echo'));
    console.log('clipboard 443(本地):', await run('curl -sk -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" https://127.0.0.1/; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
