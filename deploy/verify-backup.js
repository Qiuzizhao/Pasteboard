'use strict';
// 验证容器内是否已部署多代备份机制
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
    console.log('=== data 目录 ===');
    console.log(await run('ls -la /home/ubuntu/pasteboard/data/'));
    console.log('=== 容器内 server.js 是否含多代备份 ===');
    console.log(await run("cd /home/ubuntu/pasteboard && docker compose -f docker-compose.nginx.yml exec -T app grep -c 'bak.2' /srv/app/server.js"));
    console.log('=== 健康 ===');
    console.log(await run('curl -s http://127.0.0.1:8001/api/health; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
