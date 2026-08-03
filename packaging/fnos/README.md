# 飞牛 fnOS 应用包

此目录用于生成飞牛应用中心可安装的 `.fpk` 包。应用包使用官方 Docker 项目资源，由飞牛应用中心管理容器的安装、启动、停止和升级。

## 构建

1. 下载官方 `fnpack` 1.2.3 或更新版本。
2. 生成应用图标：

   ```bash
   python scripts/build_fnos_assets.py
   ```

3. 构建应用包：

   ```bash
   fnpack build --directory packaging/fnos/songlib-amp
   ```

构建产物为 `packaging/fnos/songlib-amp/songlib-amp.fpk`。发布前必须在飞牛 fnOS 测试设备上完成安装、桌面入口、容器健康、数据持久化、停止/启动和升级验证。

上架文案与实机结果分别记录在 [`STORE-LISTING.md`](STORE-LISTING.md) 和 [`TEST-REPORT.md`](TEST-REPORT.md)。

## 安装后的目录

- 私有应用数据：飞牛应用数据目录，对应容器 `/data`。
- `songlib-amp/music`：正式音乐库共享目录，对应容器 `/music`。
- `songlib-amp/downloads`：独立下载与整理暂存目录，对应容器 `/downloads`。

应用安装向导只询问访问端口，默认 `32782`。主人账号、Plex、飞牛音乐与音乐源均在首次打开后的网页向导或设置页中配置。

## 架构与镜像

Manifest 声明 `platform=all`，应用包本身不含平台相关二进制。固定镜像 `666uos/songlib-amp:1.0.0-rc.6` 同时提供 `linux/amd64` 与 `linux/arm64`。
