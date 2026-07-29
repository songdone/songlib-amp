# 开发与质量门禁

## 本地环境

- Python 3.12
- Node.js 24.14
- Docker 24+ 与 Compose 2.20+

后端模块从 `backend` 目录加载。测试使用临时数据目录，不访问生产音乐库。

```bash
python -m pip install -r backend/requirements.lock
PYTHONPATH=backend python -m unittest discover -s backend/tests -v
python -m compileall -q backend/app
```

```bash
cd frontend
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm run build
```

## 分层约束

- 路由只负责协议、鉴权和输入输出，不在页面路由内编写媒体匹配算法。
- 领域服务不依赖浏览器状态，也不读取 Cookie。
- 媒体库、元数据和授权下载来源通过 `adapters.py` 中的接口接入。
- 后台任务只通过持久队列运行；处理器必须支持幂等调用或使用任务幂等键。
- 数据库结构只通过版本化迁移演进，不得在请求处理中临时修改 schema。
- Token、密码、Cookie 和完整来源代码不得进入普通日志或审计详情。

## 完成定义

每个用户可见入口必须满足：

1. 有真实 API 或本地播放动作。
2. 成功后可观察到状态变化。
3. 失败时显示可行动的反馈。
4. 需要写入或移动文件时，有预览、审计或恢复路径。
5. 桌面和窄屏布局可用。

合并前执行：

```bash
python scripts/secret_scan.py
docker compose --env-file .env.example config --quiet
docker build -t songlib-amp:check .
```

CI 定义位于 `.github/workflows/ci.yml`。
