'use strict';
// 通过 GitHub 更新服务器代码并重建容器（替代 SFTP 上传，更稳）
// 使用方式: PB_HOST= PB_PORT= PB_USER= PB_PASSWORD= node update-git.js
const { Client } = require('ssh2');

const HOST = process.env.PB_HOST, PORT = Number(process.env.PB_PORT || 22),
      USER = process.env.PB_USER, PASSWORD = process.env.PB_PASSWORD;
if (!HOST || !USER || !PASSWORD) { console.error('缺少 PB_HOST/PB_USER/PB_PASSWORD'); process.exit(1); }

const REMOTE_DIR = '/home/' + USER + '/pasteboard';
const REPO = 'https://github.com/Qiuzizhao/Pasteboard.git';

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
    console.log('检查 git...');
    let r = await run('git --version 2>&1');
    if (r.startsWith('ERR') || r.indexOf('git version') === -1) {
      console.log('安装 git...');
      console.log((await run('sudo apt-get update -qq && sudo apt-get install -y -qq git 2>&1')).slice(-200));
    } else {
      console.log(r.split('\n')[0]);
    }

    console.log('初始化/同步仓库...');
    console.log(await run('cd ' + REMOTE_DIR + ' && git init -q 2>&1; git remote remove origin 2>/dev/null; git remote add origin ' + REPO + '; git fetch -q origin main 2>&1; git reset --hard origin/main 2>&1 | tail -2'));

    console.log('确认关键文件到位...');
    console.log(await run('cd ' + REMOTE_DIR + ' && ls app/static/ && wc -c app/static/index.html app/static/sw.js'));

    console.log('重建并启动容器...');
    r = await run('cd ' + REMOTE_DIR + ' && docker compose up -d --build 2>&1', 300000);
    console.log(r.split('\n').filter((l) => /Started|Running|Built|Error|error/i.test(l)).slice(-6).join('\n') || r.slice(-400));

    await new Promise((res) => setTimeout(res, 6000));
    console.log('--- compose ps ---');
    console.log(await run('cd ' + REMOTE_DIR + ' && docker compose ps --format "table {{.Name}}\t{{.Status}}"'));

    console.log('--- 源站验证 ---');
    console.log('80:', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" http://127.0.0.1/; echo'));
    console.log('PWA 资源:', await run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/manifest.webmanifest; echo'));
    console.log('sw.js:', await run('curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8000/sw.js; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
