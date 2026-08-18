'use strict';
// 验证 Caddy 双监听配置
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
    });
  });
  (async () => {
    console.log('=== 源站 80（带 Host，应 401 而非 308）===');
    console.log(await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" http://127.0.0.1/api/health; echo'));
    console.log('=== 源站 443（带 Host，应 401）===');
    console.log(await run('curl -sk -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" https://127.0.0.1/api/health; echo'));
    console.log('=== 源站 443 证书主题 ===');
    console.log(await run("echo | openssl s_client -connect 127.0.0.1:443 -servername clipboard.qiuzizhao.com 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null | head -3"));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
