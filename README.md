# SongLib Amp｜音屿

> 让散落的音乐，回到自己的岛屿。

SongLib Amp 是一个本地优先、面向 NAS 的音乐管理与播放平台。它把音乐目录、Plex、元数据、歌词、歌单、后台任务和个人推荐放进一个清晰的工作流，同时让完整听歌历史留在自己的设备上。

## 能做什么

- 扫描真实音乐目录，查看格式、码率、采样率、位深、缺失资源和重复项。
- 连接 Plex，同步资料库与歌单，预览后刷新媒体与补齐素材。
- 从可插拔提供方搜索元数据、封面和歌词；候选结果经过名称、艺人、专辑、时长和版本校验。
- 管理用户有权使用的下载来源，经过预检、暂存、确认和隔离后再入库。
- 创建歌单，导入或导出 M3U/M3U8；也可从 QQ 音乐、网易云音乐公开分享链接预览并迁移到 Plex 或已配置的飞牛音乐。
- 将独立下载目录中的音频按标签和路径预览后规范入库，保留冲突、失败与回滚记录。
- 连续播放、播放队列、歌词、随机/循环、键盘操作与响应式移动体验。
- 根据收藏、完成、跳过和重复播放形成本地画像，给出可解释推荐，并保留库外探索能力。
- 通过持久后台任务完成扫描、下载、刮削、补图和补歌词；服务重启后可继续、重试或人工恢复。

SongLib Amp 不内置第三方私钥，不绕过 DRM，也不附带受版权保护的音频。请只接入你信任且有权使用的服务和内容。

## 快速部署

要求：Docker 24+、Docker Compose 2.20+，推荐至少 2 GB 可用内存。Docker Hub 固定版本镜像同时提供 `linux/amd64` 与 `linux/arm64`，NAS 不需要编译源码。

```bash
mkdir -p songlib-amp/volumes/{data,downloads,music}
cd songlib-amp
touch .env
chmod 600 .env
```

在 `.env` 中填写：

```dotenv
COMPOSE_PROJECT_NAME=songlib-amp
SONGLIB_IMAGE=666uos/songlib-amp:1.0.0-rc.4
APP_PORT=32782
APP_BIND_ADDRESS=0.0.0.0
TZ=Asia/Shanghai
PUID=1000
PGID=1000

# 使用 openssl rand -hex 32 生成，至少 32 个字符
SESSION_SECRET=replace-with-a-long-random-value
COOKIE_SECURE=false
TRUSTED_ORIGINS=http://NAS地址:32782

SONGLIB_DATA_DIR=./volumes/data
SONGLIB_DOWNLOADS_DIR=./volumes/downloads
MUSIC_DIR=./volumes/music
```

将下面内容保存为 `docker-compose.yml`。音乐库与下载暂存是两个独立挂载，不能指向同一目录：

```yaml
name: ${COMPOSE_PROJECT_NAME:-songlib-amp}

x-songlib-common: &songlib-common
  image: ${SONGLIB_IMAGE:-666uos/songlib-amp:1.0.0-rc.4}
  pull_policy: always
  user: "${PUID:-1000}:${PGID:-1000}"
  restart: unless-stopped
  env_file:
    - .env
  environment:
    TZ: ${TZ:-Asia/Shanghai}
    APP_ENV: production
    APP_VERSION: 1.0.0-rc.4
    DATA_DIR: /data
    MUSIC_ROOT: /music
    DOWNLOAD_ROOT: /downloads
    NODE_BINARY: /usr/bin/node
  volumes:
    - ${SONGLIB_DATA_DIR:-./volumes/data}:/data
    - ${SONGLIB_DOWNLOADS_DIR:-./volumes/downloads}:/downloads
    - ${MUSIC_DIR:-./volumes/music}:/music
  networks:
    - songlib-internal
  read_only: true
  tmpfs:
    - /tmp:size=256m,mode=1777
  cap_drop:
    - ALL
  security_opt:
    - no-new-privileges:true

services:
  web:
    <<: *songlib-common
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      APP_ENV: production
      APP_VERSION: 1.0.0-rc.4
      DATA_DIR: /data
      MUSIC_ROOT: /music
      DOWNLOAD_ROOT: /downloads
      NODE_BINARY: /usr/bin/node
      PORT: 8080
      WORKER_MODE: web
    ports:
      - ${APP_BIND_ADDRESS:-0.0.0.0}:${APP_PORT:-32782}:8080
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/api/health/ready',timeout=3)"]
      interval: 30s
      timeout: 5s
      start_period: 25s
      retries: 3

  worker:
    <<: *songlib-common
    command: ["python", "-m", "app.worker"]
    environment:
      TZ: ${TZ:-Asia/Shanghai}
      APP_ENV: production
      APP_VERSION: 1.0.0-rc.4
      DATA_DIR: /data
      MUSIC_ROOT: /music
      DOWNLOAD_ROOT: /downloads
      NODE_BINARY: /usr/bin/node
      WORKER_MODE: worker
    depends_on:
      web:
        condition: service_healthy
    healthcheck:
      disable: true

networks:
  songlib-internal:
    name: ${COMPOSE_PROJECT_NAME:-songlib-amp}-internal
    driver: bridge
```

然后启动：

```bash
docker compose pull
docker compose up -d
docker compose ps
```

`PUID` 与 `PGID` 必须是拥有 `volumes` 目录的 NAS 普通账号数字 ID，可用 `id -u` 与 `id -g` 查看。容器仍以非 root 身份运行，同时能够写入数据、下载暂存和正式曲库挂载。

打开 `http://NAS地址:APP_PORT`。新实例不会创建默认弱密码，首次访问会引导创建主人账号。

升级时先备份 `SONGLIB_DATA_DIR`，再把 `.env` 中的镜像标签改为目标版本并执行：

```bash
docker compose pull
docker compose up -d
```

需要回滚时把 `SONGLIB_IMAGE` 改回上一个固定标签，再次执行相同命令。仓库内的 [`docker-compose.yml`](docker-compose.yml) 与上面模板一致；只有参与开发时才使用 `docker-compose.build.yml` 在本机编译。

## 服务与数据

Compose 使用独立桥接网络和两个最小权限服务：

- `web`：界面和 API。
- `worker`：扫描、下载、刮削和整理任务。

持久数据：

- `/data/manager.db`：账号、配置、任务、歌单、画像与审计记录。
- `/data/sources/`：用户主动导入的来源适配脚本。
- `/data/backups/`：SQLite 在线备份。
- `/music/_incoming/`：待确认内容。
- `/music/.trash/`：可恢复隔离区。
- `/downloads/`：独立下载暂存区与手工整理入口，不能与 `/music/` 指向同一目录。

令牌和私密配置只应存在于 NAS 上权限为 `600` 的 `.env` 或受保护数据目录中。

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [部署与首次安装](docs/DEPLOYMENT.md)
- [升级、备份、恢复与故障排查](docs/OPERATIONS.md)
- [安全边界](docs/SECURITY.md)
- [从 0.8 升级](docs/MIGRATION-0.8.md)
- [开发与质量门禁](DEVELOPMENT.md)
- [变更记录](CHANGELOG.md)

## 开发

后端：

```bash
python -m pip install -r backend/requirements.txt
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
```

前端：

```bash
cd frontend
pnpm install --frozen-lockfile
pnpm test
pnpm run build
```

所有改动通过 Pull Request 合入。默认分支受到 CI 的后端测试、前端生产构建、Compose 校验、镜像构建和敏感信息扫描保护。
