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

### 后端

- 路由只负责协议、鉴权和输入输出，不在页面路由内编写媒体匹配算法。
- 新增路由写进 `app/routers/` 里对应的域模块；确实是新域就新建模块并在
  `main.py` 里 `include_router`，不要往 `main.py` 直接写 `@app.get`。
- 请求体模型统一放 `app/schemas.py`。
- 领域服务不依赖浏览器状态，也不读取 Cookie。
- 媒体库、元数据和授权下载来源通过 `adapters.py` 中的接口接入。
- 后台任务只通过持久队列运行；处理器必须支持幂等调用或使用任务幂等键。
- 数据库结构只通过版本化迁移演进，不得在请求处理中临时修改 schema。
- Token、密码、Cookie 和完整来源代码不得进入普通日志或审计详情。

### 前端

完整说明见 [docs/UI-REFACTOR.md](docs/UI-REFACTOR.md)，要点：

- 颜色、字号、间距只能来自 `src/styles/tokens.css` 的语义 token，
  组件样式里不写颜色字面量。
- 优先级由 `src/styles/index.css` 声明的 `@layer` 顺序决定。
  除 `reset.css` 里 `prefers-reduced-motion` 那一处外，不允许出现 `!important`。
- 换主题只改 token 值。`tokens.css` 以外的文件不出现 `[data-theme]` 选择器。
- 控件用 `primitives.css` 里已有的形态；按钮只有 primary / secondary /
  ghost / danger 四个语义变体，一屏最多一个 primary。
- 代码按用户任务放进 `src/features/`，被两个以上 feature 用到才上移到
  `src/components/` 或 `src/lib/`。`main.jsx` 不放界面逻辑。
- 测试断言意图，不断言实现手法；"整个前端都不该出现 X"要扫全树。

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
