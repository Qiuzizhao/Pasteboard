'use strict';
// 全量更新：上传新配置/前端并重建容器
// 使用方式: PB_HOST= PB_PORT= PB_USER= PB_PASSWORD= node update-all.js
const path = require('path');
const { Client } = require('ssh2');

const HOST = process.env.PB_HOST, PORT = Number(process.env.PB_PORT || 22),
      USER = process.env.PB_USER, PASSWORD = process.env.PB_PASSWORD;
if (!HOST || !USER || !PASSWORD) { console.error('缺少 PB_HOST/PB_USER/PB_PASSWORD'); process.exit(1); }

const REMOTE_DIR = '/home/' + USER + '/pasteboard';
const ROOT = path.resolve(__dirname, '..');
const FILES = [
  ['Caddyfile', 'Caddyfile'],
  ['docker-compose.yml', 'docker-compose.yml'],
  ['.env.example', '.env.example'],
  ['app/static/index.html', 'app/static/index.html'],
];

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
    for (const [local, remote] of FILES) {
      await new Promise((res, rej) => sftp.fastPut(path.join(ROOT, local), REMOTE_DIR + '/' + remote, (e) => (e ? rej(e) : res())));
      console.log('已上传 ' + local);
    }
    sftp.end();

    console.log('重建并启动容器（docker compose up -d --build）...');
    const r = await run('cd ' + REMOTE_DIR + ' && docker compose up -d --build 2>&1', 300000);
    if (r.startsWith && r.startsWith('ERR')) { console.error(r); process.exit(1); }
    const lines = r.split('\n').filter((l) => /Started|Running|Built|Error|error|recreated/i.test(l));
    console.log(lines.slice(-10).join('\n') || r.slice(-600));

    await new Promise((res) => setTimeout(res, 6000));
    console.log('--- compose ps ---');
    console.log(await run('cd ' + REMOTE_DIR + ' && docker compose ps --format "table {{.Name}}\t{{.Status}}" 2>&1'));

    console.log('--- 源站 80 页面（带 Host，应 200）---');
    console.log(await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" http://127.0.0.1/; echo'));
    console.log('--- 源站 443 页面（带 Host，应 200）---');
    console.log(await run('curl -sk -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" https://127.0.0.1/; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
