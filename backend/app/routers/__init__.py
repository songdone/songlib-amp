"""HTTP 路由层。

重构前 129 个路由全部挂在 main.py 的 `@app` 上，单文件 2,435 行。
docs/ARCHITECTURE.md 里写的分层（"路由只负责协议、鉴权和输入输出"）
在领域模块上落实得不错，但 HTTP 层本身一直没有拆开。

现在每个用户任务域一个 APIRouter 模块，main.py 只负责装配：
创建 app、注册中间件、include_router、挂载静态资源。

新增路由时找对应的域文件；如果确实是一个新域，就新建一个模块并在
main.py 里 include，不要往 main.py 里直接写 `@app.get`。
"""
