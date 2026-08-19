'use strict';
// 收尾：验证站点可达 + 确保证书 + systemd 接管 nginx
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
    console.log('===== 1. 当前站点可达性 =====');
    for (const host of ['schedule.qiuzizhao.com', 'htmldeploy.qiuzizhao.com', 'supabase.qiuzizhao.com', 'salary.qiuzizhao.com', 'simpletts.qiuzizhao.com', 'clipboard.qiuzizhao.com']) {
      console.log(host, '->', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: ' + host + '" http://127.0.0.1/; echo'));
    }

    console.log('===== 2. 证书状态 =====');
    console.log(await run('sudo ls /etc/letsencrypt/live/ 2>&1; sudo ls /etc/letsencrypt/live/clipboard.qiuzizhao.com/ 2>&1 | head -5'));

    console.log('===== 3. vhost 是否已含 ssl =====');
    console.log(await run('grep -E "listen 443|ssl_certificate|return 301" /etc/nginx/sites-enabled/clipboard || echo 无 ssl 配置'));

    console.log('===== 4. systemd 与运行实例一致化 =====');
    console.log(await run('sudo nginx -s stop 2>&1; sleep 1; sudo systemctl start nginx 2>&1; sleep 1; sudo systemctl is-active nginx'));

    console.log('===== 5. 证书签发（如缺失）=====');
    const cert = await run('sudo test -f /etc/letsencrypt/live/clipboard.qiuzizhao.com/fullchain.pem && echo YES || echo NO');
    if (cert.includes('NO')) {
      console.log(await run('sudo certbot --nginx -d clipboard.qiuzizhao.com --redirect --non-interactive --register-unsafely-without-email --agree-tos 2>&1 | tail -5'));
    } else {
      console.log('证书已存在，跳过签发');
    }

    console.log('===== 6. 本地 HTTPS 验证 =====');
    console.log(await run("echo | openssl s_client -connect 127.0.0.1:443 -servername clipboard.qiuzizhao.com 2>/dev/null | openssl x509 -noout -subject -dates 2>/dev/null | head -3"));
    console.log('clipboard 443:', await run('curl -sk -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" https://127.0.0.1/; echo'));

    console.log('===== 7. 复检全部站点 =====');
    for (const host of ['schedule.qiuzizhao.com', 'htmldeploy.qiuzizhao.com', 'supabase.qiuzizhao.com', 'salary.qiuzizhao.com', 'simpletts.qiuzizhao.com', 'clipboard.qiuzizhao.com']) {
      console.log(host, '->', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: ' + host + '" http://127.0.0.1/; echo'));
    }
    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
