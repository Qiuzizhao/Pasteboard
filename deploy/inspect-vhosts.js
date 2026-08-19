'use strict';
// 查看关键 nginx vhost 配置 + certbot 可用性
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
    console.log('===== class-schedule vhost =====');
    console.log(await run('cat /etc/nginx/sites-enabled/class-schedule'));
    console.log('===== htmldeploy vhost =====');
    console.log(await run('cat /etc/nginx/sites-enabled/htmldeploy'));
    console.log('===== certbot? =====');
    console.log(await run('certbot --version 2>&1 | head -1; which certbot'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
