'use strict';
// 检查服务器剪贴板数据现状 + 寻找可恢复的备份
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
    console.log('===== data 目录内容 =====');
    console.log(await run('ls -la /home/ubuntu/pasteboard/data/ 2>&1; ls -la /home/ubuntu/pasteboard/data/images/ 2>&1 | head -10'));
    console.log('===== 当前 state.json =====');
    console.log(await run('cat /home/ubuntu/pasteboard/data/state.json 2>&1 | head -c 800'));
    console.log('');
    console.log('===== 找 tmp/备份文件 =====');
    console.log(await run('find /home/ubuntu/pasteboard -name "*.tmp" -o -name "*.bak" -o -name "*~" 2>/dev/null | head; find /home/ubuntu/pasteboard/data -type f 2>/dev/null'));
    console.log('===== API 当前状态 =====');
    console.log(await run('curl -s http://127.0.0.1:8001/api/clipboard; echo; curl -s http://127.0.0.1:8001/api/history | head -c 300'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
