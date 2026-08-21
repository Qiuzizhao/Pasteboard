'use strict';
// 从备份恢复剪贴板数据
// ⚠️ 危险操作：会用备份文件覆盖当前 state.json！
// 使用方式: CONFIRM_RESTORE=yes [BAK=state.json.bak|state.json.bak.1|state.json.bak.2] node restore-backup.js
const { Client } = require('ssh2');

const HOST = process.env.PB_HOST, PORT = Number(process.env.PB_PORT || 22),
      USER = process.env.PB_USER, PASSWORD = process.env.PB_PASSWORD;
if (!HOST || !USER || !PASSWORD) { console.error('缺少 PB_HOST/PB_USER/PB_PASSWORD'); process.exit(1); }
if (process.env.CONFIRM_RESTORE !== 'yes') {
  console.error('⚠️ 安全确认缺失：此脚本会用备份覆盖当前数据！');
  console.error('如确认执行，请设置 CONFIRM_RESTORE=yes');
  process.exit(1);
}

const BAK = process.env.BAK || 'state.json.bak';
const DATA_DIR = '/home/' + USER + '/pasteboard/data';

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
    console.log('===== 当前与备份概览 =====');
    console.log(await run('ls -la ' + DATA_DIR + '/'));
    console.log('当前 history 条数:', await run('cat ' + DATA_DIR + '/state.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get(\\'history\\',[])))" 2>/dev/null || echo 解析失败'));
    console.log('备份 ' + BAK + ' history 条数:', await run('cat ' + DATA_DIR + '/' + BAK + ' | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get(\\'history\\',[])))" 2>/dev/null || echo 解析失败'));

    console.log('===== 停止应用并恢复 =====');
    console.log(await run('cd /home/' + USER + '/pasteboard && docker compose -f docker-compose.nginx.yml stop app 2>&1'));
    console.log(await run('cp ' + DATA_DIR + '/' + BAK + ' ' + DATA_DIR + '/state.json && echo 已用 ' + BAK + ' 覆盖 state.json'));
    console.log(await run('cd /home/' + USER + '/pasteboard && docker compose -f docker-compose.nginx.yml start app 2>&1'));
    await new Promise((r) => setTimeout(r, 5000));
    console.log('恢复后 history 条数:', await run('cat ' + DATA_DIR + '/state.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d.get(\\'history\\',[])))" 2>/dev/null'));
    console.log('应用健康:', await run('curl -s http://127.0.0.1:8001/api/health; echo'));
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
