# SongLib Amp｜音屿

> 让散落的音乐，回到自己的岛屿。

面向 NAS 的音乐下载、刮削、整理与 Plex 联动小系统。音屿在本地管理歌手海报、横版背景、中文简介、专辑封面、时间轴歌词与音乐下载，不把 Plex 当作产品品牌，也不会把你的曲库数据上传到第三方服务。

## 核心闭环

- 三种音乐源导入：在线 raw URL、本地 `.js` 上传、直接粘贴源码
- `/data/sources/` 随机安全文件名、SHA-256 去重、2 MB 默认上限
- 对齐洛雪 `window.lx` 事件协议，真实支持混淆脚本；不再通过源码明文猜测兼容性
- `inspect` 格式检测：LX Event、CommonJS、ESM default、全局 IIFE 探测与能力报告
- 来源状态分层：未验证、已导入、格式已识别、搜索可用、解析可用、部分可用、不可用、已禁用
- 短生命周期 Node VM 隔离加载；来源网络请求与重定向均执行 DNS/SSRF 检查
- QQ 音乐/网易云目录搜索归一化、真实音频地址解析与前 4 KB 探测
- 下载前再次预检，下载到 `/music/_incoming/` 后写标签、封面与 LRC
- 下载完成生成入库 dry-run 预览，用户确认后才按 Plex 目录规则移动；取消则进入 `.trash`
- 入库后触发 Plex 扫描；扫描失败只写任务警告，不删除已下载歌曲
- 来源日志与任务逐步骤日志，失败提供明确错误码和中文原因
- `files` 与 `plex_items` 分表：本地曲库扫描、标签编辑、缺失信息、Plex 匹配与整理预览
- 操作日志与安全回滚、本地文件流式预览、底部轻量播放器和本地优先音乐发现

原有 Plex 资料库总览、歌手/专辑/单曲浏览、歌手资料焕新、缺失封面与歌词补齐均保留。

## 设计参考与边界

功能思路参考 [LX Music Desktop](https://github.com/lyswhut/lx-music-desktop)、[lx-music-source](https://github.com/pdone/lx-music-source) 与 [Music Tag Web](https://github.com/xhongc/music-tag-web)。本项目为独立实现，没有复制这些项目的代码，也不随镜像内置第三方音乐源。

LX 自定义源主要负责为目录搜索结果解析在线地址。请只导入你信任且有权使用的来源，只下载你有权保存的内容；音屿不绕过 DRM，也不承诺第三方来源的合法性、准确性或持续可用性。

## Docker 部署

复制环境变量模板并设置宿主机目录：

```bash
cp .env.example .env
```

至少修改以下两项为设备上的真实路径：

```dotenv
MUSIC_DIR=/path/to/your/music
PLEX_CONFIG_DIR=/path/to/Plex Media Server
```

`SONGLIB_DATA_DIR` 和 `SONGLIB_DOWNLOADS_DIR` 默认使用项目目录内的 `data`、`downloads`。极空间用户可将项目放在 Docker 面板可识别的官方目录，再在 `.env` 中填写本机的媒体库和 Plex 配置路径。

启动：

```bash
docker compose up -d --build
```

Web UI 从 `32781` 开始选择空闲端口，写入 `.env` 的 `APP_PORT`。Compose 使用 host 网络访问本机 Plex `127.0.0.1:32400`。

## 持久化数据

- `/data/manager.db`：设置、来源状态、来源日志、任务与任务日志
- `/data/sources/`：用户主动导入的来源脚本
- `/music/_incoming/`：下载与标签写入临时区
- `/music/{歌手}/{专辑}/`：用户确认后的正式曲库
- `/music/.trash/`：取消入库及后续安全删除的回收站
- `/music/**.lrc`：本地时间轴歌词
- Plex Token：保存在 NAS 本地 `/data`，也可从只读挂载的 `Preferences.xml` 读取；不会上传到第三方服务

改造前问题与迁移边界记录在 [DEVELOPMENT.md](./DEVELOPMENT.md)。
