'use strict';

/**
 * Pasteboard 服务器部署脚本（ssh2，密码认证）
 *
 * 环境变量：
 *   PB_HOST       服务器 IP
 *   PB_PORT       SSH 端口
 *   PB_USER       SSH 用户名
 *   PB_PASSWORD   SSH 密码
 *   PB_DOMAIN     站点域名（默认 clipboard.qiuzizhao.com）
 *
 * 流程：
 *   1. 检查 sudo / docker
 *   2. 安装 Docker + Compose 插件（get.docker.com，失败则 apt）
 *   3. 上传项目文件到 /home/ubuntu/pasteboard
 *   4. 生成令牌与密码，写入 .env，生成 Caddy bcrypt 哈希
 *   5. docker compose up -d --build
 *   6. 验证 app / caddy 健康与证书
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');

const HOST = process.env.PB_HOST;
const PORT = Number(process.env.PB_PORT || 22);
const USER = process.env.PB_USER;
const PASSWORD = process.env.PB_PASSWORD;
const DOMAIN = process.env.PB_DOMAIN || 'clipboard.qiuzizhao.com';

if (!HOST || !USER || !PASSWORD) {
  console.error('缺少环境变量 PB_HOST / PB_USER / PB_PASSWORD');
  process.exit(1);
}

const REMOTE_DIR = '/home/' + USER + '/pasteboard';
const LOCAL_ROOT = path.resolve(__dirname, '..');

// 上传清单（本地相对路径 → 远端相对路径）
const UPLOAD_FILES = [
  ['app/server.js', 'app/server.js'],
  ['app/static/index.html', 'app/static/index.html'],
  ['Dockerfile', 'Dockerfile'],
  ['docker-compose.yml', 'docker-compose.yml'],
  ['Caddyfile', 'Caddyfile'],
  ['README.md', 'README.md'],
];

function log(msg) { console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg); }

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn));
    conn.on('error', reject);
    conn.connect({ host: HOST, port: PORT, username: USER, password: PASSWORD, readyTimeout: 20000 });
  });
}

// 执行远端命令（bash -lc），返回 {code, out, err}
function exec(conn, cmd, timeoutMs) {
  return new Promise((resolve, reject) => {
    conn.exec('bash -lc ' + JSON.stringify(cmd), (err, stream) => {
      if (err) return reject(err);
      let out = '', errout = '';
      const timer = timeoutMs ? setTimeout(() => { try { stream.close(); } catch (_) {} }, timeoutMs) : null;
      stream.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, out: out.trim(), err: errout.trim() });
      });
      stream.on('data', (d) => { out += d.toString('utf8'); });
      stream.stderr.on('data', (d) => { errout += d.toString('utf8'); });
    });
  });
}

// 带 sudo 执行（优先免密，失败则管道密码）
async function sudo(conn, cmd, timeoutMs) {
  let r = await exec(conn, 'sudo -n true 2>/dev/null && echo SUDO_NOPASS_OK', 15000);
  if (r.out.includes('SUDO_NOPASS_OK')) {
    return exec(conn, 'sudo ' + cmd, timeoutMs);
  }
  return exec(conn, "echo '" + PASSWORD.replace(/'/g, "'\\''") + "' | sudo -S -p '' " + cmd, timeoutMs);
}

function sftpPut(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    sftp.fastPut(local, remote, (err) => (err ? reject(err) : resolve()));
  });
}

function sftpMkdirp(sftp, dir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, { recursive: true }, (err) => (err && err.code !== 4 ? reject(err) : resolve()));
  });
}

(async () => {
  log('连接 ' + USER + '@' + HOST + ':' + PORT + ' ...');
  const conn = await connect();
  log('已连接');

  // ---- 1. 基础检查 ----
  let r = await exec(conn, 'id && . /etc/os-release && echo "OS: $PRETTY_NAME" && uname -m', 20000);
  log(r.out);
  if (r.code !== 0) { log('基础检查失败: ' + r.err); process.exit(1); }

  r = await exec(conn, 'docker --version 2>/dev/null; docker compose version 2>/dev/null', 20000);
  const hasDocker = r.out.includes('Docker version') || r.out.includes('docker');
  const hasCompose = r.out.includes('Compose') || r.out.toLowerCase().includes('compose');
  log('Docker: ' + (hasDocker ? '已安装' : '未安装') + ' | Compose: ' + (hasCompose ? '已安装' : '未安装'));

  if (!hasDocker) {
    log('安装 Docker（get.docker.com）...');
    r = await sudo(conn, "bash -c 'curl -fsSL https://get.docker.com | sh' 2>&1", 300000);
    if (r.code !== 0) {
      log('get.docker.com 失败，改用 apt 安装...');
      r = await sudo(conn, "apt-get update -qq && apt-get install -y -qq docker.io docker-compose-plugin 2>&1", 600000);
    }
    if (r.code !== 0) { log('Docker 安装失败:\n' + r.err + '\n' + r.out); process.exit(1); }
    await sudo(conn, 'systemctl enable --now docker', 60000);
    log('Docker 安装完成');
  } else if (!hasCompose) {
    log('安装 docker-compose-plugin...');
    r = await sudo(conn, 'apt-get update -qq && apt-get install -y -qq docker-compose-plugin 2>&1', 300000);
    if (r.code !== 0) { log('compose 插件安装失败:\n' + r.err); process.exit(1); }
  }

  // ---- 2. 释放 80/443 端口（默认 web 服务可能占用） ----
  log('检查 80/443 端口占用...');
  r = await sudo(conn, "ss -tlnp 2>/dev/null | grep -E ':(80|443) ' || echo NO_LISTENER", 30000);
  if (!r.out.includes('NO_LISTENER')) {
    log('端口被占用:\n' + r.out);
    for (const svc of ['nginx', 'apache2', 'httpd', 'caddy']) {
      await sudo(conn, 'systemctl stop ' + svc + ' 2>/dev/null; systemctl disable ' + svc + ' 2>/dev/null; true', 30000);
    }
    log('已尝试停止默认 web 服务，重新检查...');
    r = await sudo(conn, "ss -tlnp 2>/dev/null | grep -E ':(80|443) ' || echo NO_LISTENER", 30000);
    log(r.out.includes('NO_LISTENER') ? '端口已释放' : '仍有占用（部署将继续，可能再次失败）:\n' + r.out);
  } else {
    log('端口空闲');
  }

  // ---- 3. 上传文件 ----
  log('上传项目文件到 ' + REMOTE_DIR + ' ...');
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await sftpMkdirp(sftp, REMOTE_DIR);
  await sftpMkdirp(sftp, REMOTE_DIR + '/app');
  await sftpMkdirp(sftp, REMOTE_DIR + '/app/static');
  for (const [localRel, remoteRel] of UPLOAD_FILES) {
    await sftpPut(sftp, path.join(LOCAL_ROOT, localRel), REMOTE_DIR + '/' + remoteRel);
    log('  上传 ' + localRel);
  }
  sftp.end();

  // ---- 3. 生成凭据并写 .env ----
  const token = crypto.randomBytes(24).toString('hex');
  const authPass = crypto.randomBytes(9).toString('base64url'); // 12 字符，无 shell 特殊字符
  log('生成 CLIPBOARD_TOKEN 与登录密码');
  log('!! 登录密码（Caddy Basic Auth，请妥善保存）: ' + authPass);
  log('!! 访问令牌（CLIPBOARD_TOKEN）: ' + token);

  log('生成 Caddy bcrypt 哈希...');
  r = await sudo(conn, "docker run --rm caddy:2 caddy hash-password --plaintext '" + authPass + "' 2>&1", 180000);
  const hashMatch = (r.out.match(/\$2[aby]\$\S+/) || [null])[0];
  if (!hashMatch) { log('bcrypt 哈希生成失败:\n' + r.out + '\n' + r.err); process.exit(1); }

  // bcrypt 哈希含 $，docker compose 会把 $VAR 当变量引用，需写成 $$ 转义
  const hashEscaped = hashMatch.replace(/\$/g, '$$$$');
  const envContent = [
    '# 由部署脚本生成，' + new Date().toISOString(),
    'CLIPBOARD_DOMAIN=' + DOMAIN,
    'CLIPBOARD_TOKEN=' + token,
    'CLIPBOARD_BASIC_AUTH_USER=admin',
    'CLIPBOARD_BASIC_AUTH_HASH=' + hashEscaped,
    '',
  ].join('\n');
  const envLocal = path.join(__dirname, '.env.deploy');
  fs.writeFileSync(envLocal, envContent, 'utf8');
  const sftp2 = await new Promise((res, rej) => conn.sftp((e, s) => (e ? rej(e) : res(s))));
  await sftpPut(sftp2, envLocal, REMOTE_DIR + '/.env');
  sftp2.end();
  fs.unlinkSync(envLocal);
  log('.env 已写入（本机临时文件已删除）');

  // ---- 4. 启动 ----
  log('docker compose up -d --build（首次需拉取镜像，请耐心等待）...');
  // ubuntu 已在 docker 组，无需 sudo；cd 是 shell 内建，整体交给 bash -lc 执行
  r = await exec(conn, 'cd ' + REMOTE_DIR + ' && docker compose up -d --build 2>&1', 600000);
  if (r.code !== 0) {
    log('compose up 失败:\n' + r.out + '\n' + r.err);
    process.exit(1);
  }
  log(r.out.split('\n').filter((l) => /Started|Running|done|Built/.test(l)).join('\n') || 'compose up 完成');

  // ---- 5. 验证 ----
  await new Promise((res) => setTimeout(res, 8000));
  r = await exec(conn, 'cd ' + REMOTE_DIR + ' && docker compose ps 2>&1', 60000);
  log('--- compose ps ---\n' + r.out);

  r = await exec(conn, 'curl -s http://127.0.0.1:8000/api/health; echo; curl -s http://127.0.0.1/api/health', 30000);
  log('--- 本地健康检查 ---\n' + r.out);

  r = await exec(conn, 'cd ' + REMOTE_DIR + " && docker compose logs --tail=40 caddy 2>&1 | grep -Ei 'certificate|error|warn|serving' | tail -20", 60000);
  log('--- Caddy 日志（证书相关） ---\n' + (r.out || '（暂无）'));

  conn.end();
  log('部署流程完成。域名: https://' + DOMAIN);
})().catch((e) => {
  console.error('部署失败:', e.message);
  process.exit(1);
});
