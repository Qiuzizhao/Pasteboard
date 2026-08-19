'use strict';
// 服务器全面体检：nginx 配置、运行服务、docker 容器、端口监听
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
    console.log('===== 1. nginx 状态 =====');
    console.log(await run('systemctl is-active nginx; systemctl is-enabled nginx'));

    console.log('===== 2. nginx 配置文件 =====');
    console.log(await run('ls /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>&1'));

    console.log('===== 3. nginx 全部 server_name =====');
    console.log(await run("sudo nginx -T 2>/dev/null | grep -E 'server_name|listen ' | head -40"));

    console.log('===== 4. nginx server 块上下文（前 150 行）=====');
    console.log((await run('sudo nginx -T 2>&1')).split('\n').slice(0, 150).join('\n'));

    console.log('===== 5. 运行中的服务（nginx/caddy/schedule/deploy/node/php）=====');
    console.log(await run("systemctl list-units --type=service --state=running --no-pager | grep -Ei 'nginx|caddy|schedule|deploy|node|php|mysql|mariadb|redis|postgres' || echo none"));

    console.log('===== 6. Docker 容器（全部）=====');
    console.log(await run('docker ps -a --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"'));

    console.log('===== 7. 端口监听 =====');
    console.log(await run("sudo ss -tlnp | grep -E ':(80|443|8000|8080|3000|8081|8443) ' || echo none"));

    console.log('===== 8. 防火墙规则 =====');
    console.log(await run('sudo iptables -L INPUT -n --line-numbers | head -15'));

    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
