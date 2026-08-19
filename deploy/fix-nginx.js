'use strict';
// 修复 v2：base64 写文件 + sudo 正确使用
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
  const writeFile = (path, content, sudo) => {
    const b64 = Buffer.from(content, 'utf8').toString('base64');
    const prefix = sudo ? 'echo ' + b64 + ' | base64 -d | sudo tee ' + path + ' > /dev/null && echo OK' :
                           'echo ' + b64 + ' | base64 -d > ' + path + ' && echo OK';
    return run(prefix);
  };
  (async () => {
    // ---- 1. 写 nginx 版 compose ----
    console.log('===== 1. 写入 docker-compose.nginx.yml =====');
    const composeNginx = [
      'services:',
      '  app:',
      '    build: .',
      '    restart: unless-stopped',
      '    environment:',
      '      - CLIPBOARD_TOKEN=${CLIPBOARD_TOKEN:?请在 .env 中设置 CLIPBOARD_TOKEN}',
      '      - CLIPBOARD_DATA_DIR=/data',
      '    ports:',
      '      - "127.0.0.1:8001:8000"',
      '    volumes:',
      '      - ./data:/data',
      '    healthcheck:',
      "      test: [\"CMD\", \"node\", \"-e\", \"fetch('http://127.0.0.1:8000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"]",
      '      interval: 30s',
      '      timeout: 5s',
      '      retries: 3',
      '      start_period: 10s',
      '',
    ].join('\n');
    console.log(await writeFile('/home/ubuntu/pasteboard/docker-compose.nginx.yml', composeNginx, false));
    console.log(await run('head -5 /home/ubuntu/pasteboard/docker-compose.nginx.yml'));

    // ---- 2. 重建 app 容器（127.0.0.1:8001）----
    console.log('===== 2. 重建 app 容器 =====');
    console.log((await run('cd /home/ubuntu/pasteboard && docker compose -f docker-compose.nginx.yml up -d --build 2>&1', 240000)).split('\n').filter((l) => /Started|Built|Running|Error|error/i.test(l)).slice(-6).join('\n'));
    await new Promise((r) => setTimeout(r, 5000));
    console.log('app 健康(8001):', await run('curl -s http://127.0.0.1:8001/api/health; echo'));

    // ---- 3. 恢复 nginx（带 sudo）----
    console.log('===== 3. 恢复 nginx =====');
    console.log(await run('sudo systemctl enable nginx 2>&1 | tail -1; sudo systemctl start nginx 2>&1; sleep 1; sudo systemctl is-active nginx'));

    // ---- 4. 验证原有站点 ----
    console.log('===== 4. 验证原有站点 =====');
    for (const host of ['schedule.qiuzizhao.com', 'htmldeploy.qiuzizhao.com', 'supabase.qiuzizhao.com', 'salary.qiuzizhao.com', 'simpletts.qiuzizhao.com']) {
      console.log(host, '->', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: ' + host + '" http://127.0.0.1/; echo'));
    }
    console.log('superme(8080) ->', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: superme.qiuzizhao.com" http://127.0.0.1:8080/; echo'));

    // ---- 5. 写剪贴板 vhost ----
    console.log('===== 5. 写入 clipboard vhost =====');
    const vhost = [
      'server {',
      '    listen 80;',
      '    server_name clipboard.qiuzizhao.com;',
      '    client_max_body_size 20m;',
      '',
      '    location / {',
      '        proxy_pass http://127.0.0.1:8001;',
      '        proxy_http_version 1.1;',
      '        proxy_set_header Upgrade $http_upgrade;',
      '        proxy_set_header Connection "upgrade";',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
      '        proxy_connect_timeout 15s;',
      '        proxy_send_timeout 300s;',
      '        proxy_read_timeout 300s;',
      '    }',
      '}',
      '',
    ].join('\n');
    console.log(await writeFile('/tmp/clipboard-vhost', vhost, false));
    console.log(await run('sudo cp /tmp/clipboard-vhost /etc/nginx/sites-available/clipboard && sudo ln -sf /etc/nginx/sites-available/clipboard /etc/nginx/sites-enabled/clipboard && sudo nginx -t 2>&1 && sudo systemctl reload nginx 2>&1 && echo VHOST_OK'));

    // ---- 6. 剪贴板 HTTP 验证（供 certbot 挑战）----
    console.log('===== 6. 剪贴板 HTTP =====');
    console.log('clipboard(80):', await run('curl -s -o /dev/null -w "%{http_code}" -H "Host: clipboard.qiuzizhao.com" http://127.0.0.1/; echo'));

    // ---- 7. 签发证书 ----
    console.log('===== 7. certbot 签发 =====');
    console.log((await run('sudo certbot --nginx -d clipboard.qiuzizhao.com --redirect --non-interactive --register-unsafely-without-email --agree-tos 2>&1 | tail -6')).slice(-700));
    console.log(await run('sudo nginx -t 2>&1 | tail -1; sudo systemctl reload nginx 2>&1; echo DONE'));

    conn.end();
  })();
});
conn.on('error', (e) => { console.error('连接失败:', e.message); process.exit(1); });
conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
