# 网页剪贴板（Pasteboard）

一个人用、多端访问的极简网页剪贴板：在一个页面里粘贴/输入文字，自动同步到服务器，其他设备打开同一个网址即可查看、复制。带历史记录，每条可一键复制。

- **后端**：Node.js 零依赖（`app/server.js`），数据存 SQLite 都不用，就一个 JSON 文件，原子写入
- **前端**：单页 `app/static/index.html`，无框架，深色主题，手机电脑通用
- **部署**：Docker Compose 一键起两个容器 —— 应用 + Caddy（自动 HTTPS、基础认证）
- **安全**：两层防护 —— Caddy 的 HTTP Basic 认证（浏览器友好）+ 应用级令牌 `X-Clipboard-Token`

## 项目结构

```
Pasteboard/
├── app/
│   ├── server.js          # 后端（零依赖，约 250 行）
│   └── static/index.html  # 前端单页（HTML+CSS+JS 全内联）
├── Dockerfile
├── docker-compose.yml     # app + caddy 两个服务
├── Caddyfile              # HTTPS 反向代理 + Basic 认证
├── .env.example           # 配置模板（复制为 .env 使用）
└── README.md
```

## 部署到服务器

> 前置条件：一台有公网 IP 的 Linux 服务器、一个已解析到该 IP 的域名、已安装 Docker 和 Docker Compose 插件。

### 1. 把项目放到服务器

```bash
# 服务器上任意目录，例如 /opt/pasteboard
git clone <你的仓库> pasteboard && cd pasteboard
# 或者直接用 scp / WinSCP 把整个文件夹传上去
```

### 2. 创建 .env 并填写

```bash
cp .env.example .env
vim .env
```

需要填三个值：

| 变量 | 说明 |
|---|---|
| `CLIPBOARD_DOMAIN` | 你的域名，如 `clip.example.com` |
| `CLIPBOARD_TOKEN` | 应用访问令牌。生成方式：`openssl rand -hex 32` |
| `CLIPBOARD_BASIC_AUTH_HASH` | Caddy 登录密码的 bcrypt 哈希，见下 |

生成 Basic 认证密码哈希：

```bash
docker run --rm caddy:2 caddy hash-password --plaintext '你的登录密码'
# 输出类似 $2a$14$xxxxxxxx...，整段粘贴到 .env 的 CLIPBOARD_BASIC_AUTH_HASH
```

### 3. 启动

```bash
docker compose up -d --build
docker compose ps        # 两个服务都应为 healthy / running
```

### 4. 生效

把域名的 A 记录指向服务器 IP（如已解析则跳过），等 HTTPS 证书自动签发（Caddy 自动完成，一般几十秒到几分钟）：

```bash
docker compose logs -f caddy   # 看到 "certificate obtained" 即成功
```

然后浏览器打开 **https://你的域名**：

1. 第一次会弹浏览器基础认证框 → 输入 `CLIPBOARD_BASIC_AUTH_USER`（默认 admin）和密码
2. 页面再弹「输入访问密钥」→ 粘贴 `CLIPBOARD_TOKEN`（每个浏览器只需输入一次，存在 localStorage）
3. 开始使用：粘贴/输入文字自动保存，其他设备打开同一网址即可看到并复制

## 使用说明

- **文字**：大输入框即当前剪贴板。输入后停 0.8 秒自动保存，切换标签页/离开页面时自动补发未保存内容，无需手动保存
- **图片**：在页面任意位置 **Ctrl+V 粘贴图片**（截图、复制图片），自动上传并同步；当前剪贴板显示图片预览，可「复制图片」回系统剪贴板或「下载」；「读取系统剪贴板」按钮会先尝试读图片、读不到再读文字
- **多端防覆盖**：如果你正在编辑，另一台设备发来更新时会显示黄色提示条，点「加载」才覆盖当前内容；没在编辑则自动同步
- **复制**：按钮用浏览器原生剪贴板 API（HTTPS 下工作），iOS Safari 等不支持的情况自动降级
- **历史记录**：文字与图片都会自动留档（连续相同内容/相同图片去重），最多 200 条，可单条删除或全部清空；图片历史可点击缩略图查看大图，支持复制图片、下载、删除
- **图片存储**：图片文件存放在服务器 `data/images/` 目录（PNG/JPG/GIF/WebP，单张 ≤ 12MB），删除历史条目时文件一并删除，重启时会自动清理孤儿文件

## 本地开发 / 自测（不需要 Docker）

```bash
cd Pasteboard
CLIPBOARD_TOKEN=随便一个测试令牌 node app/server.js
# 浏览器打开 http://localhost:8000
```

数据默认写入 `data/state.json`（已被 .gitignore 忽略）。

## 安全与备份

- **两层认证**：Caddy Basic 认证只保护页面本身（浏览器首次访问询问一次）；`/api/*` 由应用令牌（`X-Clipboard-Token`）保护。这样设计是为了避免移动端浏览器对 XHR/fetch 的 401 响应反复弹出登录框
- **明文存储警告**：历史记录以明文保存在服务器的 `data/state.json` 里。**不要**长期存放密码、密钥等敏感信息；服务器磁盘被攻破时这些内容会暴露
- **备份**：备份 `data/` 目录即可（就一个 JSON 文件）。升级前建议先 `docker compose cp app:/data/state.json ./state.json.bak`
- **防火墙**：服务器只需开放 80/443 端口

## 常见问题

- **修改 .env 后如何生效**：`docker compose up -d` 会重建配置；改了 `CLIPBOARD_TOKEN` 后所有已登录的浏览器会收到 401，重新输入新令牌即可
- **想去掉 Caddy Basic 认证**：删除 Caddyfile 里两个 `basic_auth { ... }` 块，并把 compose 中 `CLIPBOARD_BASIC_AUTH_HASH` 的 `:?` 校验删掉，`up -d` 重建
- **想改历史条数上限**：给 app 服务加环境变量 `CLIPBOARD_HISTORY_LIMIT=500`
