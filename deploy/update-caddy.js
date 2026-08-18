'use strict';
// 更新服务器上的 Caddyfile 并热重载
// 使用方式: PB_HOST= PB_PORT= PB_USER= PB_PASSWORD= node update-caddy.js
const fs = require('fs');
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.PB_HOST, PORT = Number(process.env.PB_PORT || 22),
      USER = process.env.PB_USER, PASSWORD = process.env.PB_PASSWORD;
if (!HOST || !USER || !PASSWORD) { console.error('缺少 PB_HOST/PB_USER/PB_PASSWORD'); process.exit(1); }

const LOCAL_CADDYFILE = path.resolve(__dirname, '..', 'Caddyfile');
const REMOTE_DIR = '/home/' + USER + '/pasteboard';

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
    const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
    await new Promise((res, rej) => sftp.fastPut(LOCAL_CADDYFILE, REMOTE_DIR + '/Caddyfile', (e) => (e ? rej(e) : res())));
    sftp.end();
    console.log('Caddyfile 已上传');

    // 热重载（不重启容器）
    console.log(await run('cd ' + REMOTE_DIR + ' && docker compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile 2>&1 || docker compose restart caddy 2>&1'));

    await new Promise((r) => setTimeout(r, 4000));
    console.log('--- 本地验证（应返回 401 需要登录 或 {"ok":true}）---');
    console.log(await run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/api/health; echo'));
    console.log(await run('curl -s -o /dev/null -w "%{http_code}" https://127.0.0.1/api/health -k; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
