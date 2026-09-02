# 前端重构与设计系统

这份文档记录 2026-09 那次重构解决了什么、现在的约束是什么、以及剩下的迁移怎么做。

## 重构前的三个根因

项目当时构建通过、测试全绿，但已经无法迭代。原因不是审美，是三处结构问题。

### 1. 界面全挤在一个文件里

`src/main.jsx` 有 9,163 行、49 个组件、156 个 `useState`、43 个 `useEffect`。
任何一次修改都要在近万行里定位，改一处必然波及别处。
git 历史里 26 次提交有 20 次是 `fix:` —— 这是在灭火，不是在开发。

### 2. 层叠战争

五个样式表叠在一起，文件名就是三次改版的化石层：

| 文件 | 行数 | `!important` |
| --- | ---: | ---: |
| `commercial.css` | 2,117 | 66 |
| `now-playing.css` | 1,397 | 4 |
| `liquid-glass.css` | 957 | 93 |
| `shell-refactor.css` | 604 | 45 |
| `styles.css` | 161 | 180 |

每次改版都叠在上面用 `!important` 压过前一层，累计 388 处。伴随的后果：

- 1,661 处颜色字面量，只有 38 个 CSS 变量 —— 没有单一真相来源，
  所以每个界面的灰色都差一点点；
- 两套互相打架的 token：`--bg/--panel/--amber` 和 `--v2-bg/--v2-surface/--v2-accent`；
- 浅色主题靠 93 条组件级选择器重写实现，而不是换 token 值；
- 全项目没有一处 `@layer`，只能靠 `!important` 决定优先级；
- 产物 CSS 270 KB，比 JS 还大。

**浅色主题那条是关键。** 用 `.visual-shell[data-theme="light"] .sidebar, .topbar, …`
逐个枚举选择器来换主题，必然会漏掉没枚举到的地方 —— 设置页二级导航在浅色下
是深色孤岛，就是这么来的。

### 3. HTTP 层没有落实分层

`docs/ARCHITECTURE.md` 写的分层在领域模块上落实得不错，但 129 个路由
全挂在 `main.py` 的 `@app` 上，2,435 行，零 `APIRouter`。

## 现在的约束

### CSS 优先级由层级决定，不用 !important

层级顺序在 `src/styles/index.css` 里一次性声明：

```
tokens → reset → base → legacy.* → primitives → components → utilities
```

越靠后的层赢，**与选择器特异性无关**。所以迁移时新写的
`.sidebar nav button`（特异性 0,1,2）能压过旧的
`.visual-shell .sidebar nav button`（0,3,2），不需要抢特异性，也不需要 `!important`。

代码里只应存在一处 `!important`：`reset.css` 里 `prefers-reduced-motion` 的强制降级。

### 颜色只能来自语义 token

`src/styles/tokens.css` 是全站唯一的颜色、字号、间距来源。规则：

1. 组件样式引用语义 token（`--surface-*`、`--text-*`、`--accent-*`…），
   不写颜色字面量。原始色阶 `--palette-*` 只在 tokens.css 内部被消费。
2. 换主题只改语义 token 的值。**其他文件里不应出现 `[data-theme]` 选择器。**
3. 主题挂在 `:root` 上（`AuthenticatedShell` 里同步到 `documentElement`）。
   挂在 div 上的话 `color-scheme` 对滚动条和表单控件无效。

### 对比度是门禁，不是建议

`scripts/check-contrast.mjs` 按 WCAG 2.1 校验深色 + 浅色两个主题共 44 组
前景/背景组合，正文 ≥ 4.5:1，大字与非文字图形 ≥ 3:1。已接入 `pnpm test`。

改颜色后跑 `pnpm run check:contrast`。不达标就是构建失败，不是警告。

### 控件形态是收敛的

`src/styles/primitives.css` 定义全站控件。按钮只有四个语义变体：

| 变体 | 用途 |
| --- | --- |
| `.btn--primary` | 页面主操作，**一屏最多一个** |
| `.btn--secondary` | 并列的次要操作，可以有多个 |
| `.btn--ghost` | 低干扰操作（工具栏、卡片角上的图标按钮） |
| `.btn--danger` | 破坏性操作 |

重构前同一优先级出现了四种外观（金色实心、深色描边、幽灵、金调深底），
这是它要解决的问题。需要第五种外观时，先确认不是把某个已有语义用错了。

排版同理，用 `base.css` 里的 `.t-*` 比例。空状态标题固定为 `.t-section` 级别 ——
重构前"正在播放"页的空状态标题 44px 压过页面标题 40px，同屏两个 H1。

### JS 按用户任务分目录

```
src/lib/         纯函数，不依赖 React
src/hooks/       跨 feature 复用的 hook
src/components/  跨 feature 复用的展示组件
src/features/    按用户任务分组，与 docs/UX-RESTRUCTURE.md 的一级导航对齐
src/app/         应用装配：App、AuthenticatedShell、路由
src/main.jsx     只做三件事，不放界面逻辑
```

判断一段代码放哪：**它服务于哪个用户任务？** 而不是它是什么技术类型。
被两个以上 feature 用到才上移到 `components/` 或 `lib/`。

### 测试不要断言实现手法

重构前有测试断言 CSS 源码里必须存在 `!important`，把坏架构锁死了；
还有测试对 `main.jsx` 做字符串匹配，代码一搬家就失效。

断言意图（"移动端登录表单留在首屏"），不要断言手法（"用 `!important` 实现"）。
"整个前端都不该出现 X"这类断言要扫全树（用 `readAllSources()`），
只扫单个文件的话代码搬家后会悄悄失效。

## 剩下的迁移

`legacy.*` 层还有约 5,100 行。迁移是**搬走**，不是再叠一层：
新样式写进对应 feature 的 `<name>.css`（`@layer components`），
同时把 `commercial.css` 等文件里被取代的规则删掉。

`features/shell/sidebar.css` 是已完成的样板，照它做。

按收益排序：

1. **`settings` 相关规则** —— 浅色主题下的深色孤岛主要在这里，
   而且 `SettingsPage.jsx` 是当前最大的文件（1,232 行），值得连组件一起拆。
2. **`topbar` 与 `mobile-nav`** —— 外壳的剩余部分，量小，做完外壳就全在 token 上了。
3. **`media-card` / `media-grid`** —— 音乐库的主要视觉面。
4. **`now-playing`** —— 1,397 行，独立性强，可以整块重写。
5. **`liquid-glass.css` 的 93 条浅色重写** —— 前面几步做完后，这些应该大部分可以直接删掉。

每迁一块，跑 `pnpm test` + 逐页截图对照。

## 已知的、尚未修的界面问题

这些是重构中确认存在、但还没动的：

- **`正在播放` 页三个"投到电视"**：页头一个（`NowPlayingPage.jsx:430`）、
  底部歌词投屏卡里标题和按钮各一个（:563、:566），另有帮助文案引用"顶部投到电视"。
  README 说页头是主操作，那底部卡片就不该重复提供同一个按钮。需要产品决策。
- **首页 hero 占 470px 只放一张专辑**，`继续播放` 被压到首屏外。
- **浅色主题下设置页二级导航是深色孤岛**（重构前就存在，见上）。

## 排查时容易踩的坑

- **GUI 自动化工具列出的"可交互元素"不等于无障碍树。** 用它判断
  a11y 问题会误报：`display:none` 的移动端导航会被列出来，
  一个 `<button>` 套若干 `<span>` 会被拆成多个条目看起来像嵌套 button。
  要下 a11y 结论就直接看源码或用真实的无障碍树。
- **`frontend/mock-server.mjs` 的数据会影响观感判断。** 它给部分条目塞了
  `/visuals/fallback-cover-vinyl.svg`（带大号品牌水印），
  于是音乐库看起来像一堵水印墙 —— 真实应用在缺封面时走的是
  `MediaCard` 里安静的 `.art-placeholder`。判断视觉问题前先确认数据来源。
- **FastAPI 0.139 起 `include_router` 会把子路由保留为 `_IncludedRouter` 嵌套对象**，
  不再摊平进 `app.routes`。遍历 `app.routes` 自查路由会漏，要走 `/openapi.json`。
