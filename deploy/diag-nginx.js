'use strict';
// 诊断 nginx 启动失败原因
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
    console.log('===== 80/443 端口 =====');
    console.log(await run("sudo ss -tlnp | grep -E ':(80|443) ' || echo 无监听"));
    console.log('===== 8001 端口 =====');
    console.log(await run("sudo ss -tlnp | grep -E ':8001 ' || echo 无监听"));
    console.log('===== nginx 错误日志 =====');
    console.log(await run('sudo tail -15 /var/log/nginx/error.log 2>&1'));
    console.log('===== journalctl =====');
    console.log(await run('sudo journalctl -u nginx --no-pager 2>&1 | tail -15'));
    console.log('===== 手动前台启动 nginx 看报错 =====');
    console.log(await run('sudo nginx -c /etc/nginx/nginx.conf 2>&1; echo "exit=$?"'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
