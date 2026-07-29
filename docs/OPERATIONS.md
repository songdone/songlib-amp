# 升级、备份与故障排查

## 备份

在线备份使用 SQLite Backup API，可在 Web 服务运行时执行：

```bash
./scripts/backup.sh
```

文件保存在数据卷的 `/data/backups`。还应由 NAS 快照或备份工具定期复制到另一块存储。音乐文件与数据库要使用相近的快照时间点。

## 恢复

```bash
./scripts/restore.sh songlib-YYYYMMDD-HHMMSS.db
```

恢复前会停止 Web 和 Worker，并先创建 `pre-restore-*` 安全副本。脚本先做 SQLite 完整性检查，成功后重新启动服务。恢复不会自动移动或覆盖音乐文件。

## 升级

```bash
./scripts/upgrade.sh
```

流程为在线备份、拉取基础镜像、重新构建、滚动重建。数据库迁移是只向前的；大版本升级前阅读 `CHANGELOG.md` 和迁移说明。

## 常见问题

### Web 健康但任务不运行

检查：

```bash
docker compose ps
docker compose logs --tail=100 worker
```

健康接口的 `checks.worker.lastSeenAt` 应持续更新。过期任务租约会自动恢复；达到最大尝试次数的任务需要在任务中心查看失败详情后重试。

### 音乐目录无权限

确认宿主机目录对 `.env` 中 `APP_UID:APP_GID` 可读写。不要把容器改成特权模式；应修正具体绑定目录的权限。

### Plex 无法连接

先在设置页使用连接测试。桥接网络下，`127.0.0.1` 指向应用容器而不是 NAS；请使用 Plex 可从容器访问的 NAS 地址或同一 Docker 网络服务名。

### M3U 大量未匹配

在导入时配置路径映射，把歌单里的旧前缀映射到容器看到的 `/music` 路径。系统会保持顺序并返回未匹配列表，不会静默替换为同名错误歌曲。

### 数据库繁忙

SQLite 启用 WAL 与 30 秒 busy timeout。不要让多套 Compose 实例共享同一个数据卷；每个实例必须有独立数据库目录。

## 日志

普通日志不得包含密码、Token、Cookie、完整授权头或私有音乐源配置。向他人提供日志前仍应人工检查 NAS 路径、用户名和媒体标题是否需要脱敏。
