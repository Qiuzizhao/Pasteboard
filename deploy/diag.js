'use strict';
// 服务器网络诊断：检查 ufw / iptables / 监听端口
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
    console.log('=== ufw status ===');
    console.log(await run('sudo ufw status 2>&1'));
    console.log('=== iptables INPUT (前 25 行) ===');
    console.log(await run('sudo iptables -L INPUT -n --line-numbers 2>&1 | head -25'));
    console.log('=== 80/443 监听 ===');
    console.log(await run("ss -tlnp 2>/dev/null | grep -E ':(80|443) ' || echo none"));
    console.log('=== nginx 服务状态 ===');
    console.log(await run('systemctl is-active nginx 2>&1; systemctl is-enabled nginx 2>&1'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
