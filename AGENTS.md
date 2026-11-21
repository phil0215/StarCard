# StarCard 仓库协作约定

> 这个仓库有多人 / 多个 agent 并发改动。以下规则是为了避免「改了没生效」「互相覆盖」「版本号错位」。

## 结构

- 页面：`/`（卡片）、`books/`、`class/`、`deskmate/`、`battle/`、`stats/`、`settings/`、`browse/`、`store/`、`community/`（社区，第 10 页；公共脚本改动 10 页都要加，最易漏 store 与 community）
- 应用代码全部在 `js/`。仓库根目录曾有同名单文件版（`app.js` 11919 行），已删除；不要再往根目录写应用代码。
- 9 个页面共用一套基础脚本（17 个，顺序固定）；页面专属模块额外叠加，例如 `class/` 额外加载 `js/classroom.js`。新增公共模块必须同步加到全部 9 个页面（`store/index.html` 最容易漏）。
- 词库 `.srcd` 放在根目录，由 `js/shop.js` 的官方商品和 `js/app.js` 的 autoLoad 按文件名引用。

## 发布

1. 所有资源引用形如 `?v=20261121h`。每次发布把**全部 9 个页面**的版本号统一提升一个字母，禁止只改一部分（否则会出现一半新一半旧的混合态）。
2. 发布前至少跑：
   - `node --check js/*.js`
   - 本地 `python3 -m http.server 8767`，逐页打开确认无报错、关键元素在（卡片/词书/班级/同桌/比赛/数据/设置/浏览/商铺）
3. push 必须带 token：`TOKEN=$(grep -oP 'oauth_token:\s*\K\S+' ~/.config/gh/hosts.yml)`，push 到 `https://phil0215:${TOKEN}@github.com/phil0215/StarCard.git`。
4. push 后用 `pages/builds/latest` 确认 `status=built` 且 commit 匹配；GitHub Pages 偶发 503，验证失败先重试再判定。

## 并发约定

- push 前必须 `git pull --rebase --autostash`。
- rebase 之后必须 grep 复查自己的改动是否还在：`匿名用户`、`ava-anon`、`set-nav-s`、`ach-`、`shop-`、`sm-fill`。
- 加功能前先 grep 是否已有实现，同一功能只保留一套。
- CSS 只在文件末尾追加覆盖段；`html[data-theme="dark"] .x` 这类单属性选择器压不过 `html[data-theme][data-look="plain"] .x`，覆盖时必须写成双属性同样 specificity。
- 冲突解决时注意 rebase 的 ours/theirs 是反的：`--ours` 是上游，`--theirs` 是本地提交。

## 关键位置

- 路由：`js/ui.js` 的 `PAGE_DIRS` / `NAV` / `renderLegacy`；`js/app.js` 的 `applyPageEntry` 里 `TABS`。
- 设置页与成就：`js/ui.js` 的 `settingsPage()`、`achievementPane()`。
- 商铺与积分：`js/shop.js`（`SCShop` 数据层 + `SCShopUI` 页面）。
- 云服务：`js/cloud-config.js`（WorkBuddy Cloud 登录/AI）、`cloudsync-config.js` + `cloudsync.js`（Supabase：`user_state` / `study_daily` / `study_summary` / `user_profile`，RPC `public_id_taken(p_id)`）。
- localStorage 键：`starcard-state-v1`、`starcard-account-v1`、`starcard-points-v1`、`starcard-shop-v1`。

## 已知坑

- **版本字母不许回用**：发布过的 `?v=值` 可能已进浏览器缓存，内容换了的资源不能再用旧值。多会话并发时字母序会乱（出现过 h/l/m 混用），稳妥做法：发布前 `grep -ro 'v=2026[0-9]*[a-z]' --include=*.html . | sort -u` 看当前值，然后**直接跳到从未出现过的值**（如换日期 `v=20261123a`），别按字母顺延猜。
- **多个 agent 共用同一本地目录**（starcard-gh-pages）：你改文件的同时别的会话也在改同一批文件。改前先拉远端最新，推完立即重新拉校验；推送被拒（远端已前进）时**重新拉取→重放自己的补丁→再推**，绝不 force。
- `cloudsync-config.js` 必须排在 `app.js` 之前：班级/云同步模块在首屏渲染时就要读到配置，排在后面会误报「云同步还没配置」。
- 子目录站点的资源根路径有两处实现，改动要同步：`js/ui.js` 的 `siteRootPath()` 与 `js/cloud-config.js` 的 `FC.siteRoot()`，两边的 `known` 目录表都要包含新增子目录（如 `store`）。
- `.content` 是 grid 多列容器，需要单列块布局的页面用 `display:block` 覆盖（设置页、商铺页）。
- 侧栏 `.streak-mini` 是 flex column 容器，里面用 `flex: 0 0 Npx` 会变成高度，细条要用 `flex: 0 0 5px` + `height:5px`。
- **死链检查**：在 HTML 里新增 `<script>`/`<link>` 必须和文件本体在同一次提交里，push 前用 `git ls-tree -r --name-only HEAD | grep 文件名` 确认文件真的进了仓库。曾出现 `index.html` 引用 `js/community.js?v=...h` 而仓库从无此文件，线上首页脚本链直接报 `Cannot read properties of undefined (reading 'Component')`。
- **版本号一次改全**：每次改动 9 个 `index.html` 的 `?v=` 必须同一次提交内统一提升一个字母（`grep -ro 'v=2026112[0-9][a-z]' --include=*.html . | sort -u` 应只输出一个值）。曾出现 h 与 k 混用，部分页命中旧缓存。
- **设置页结构**：`settingsPage()` 已是两栏（`.set-layout` = 左 `.set-side`/`.ss-item` + 右 `.set-main`/`.set-main-head`），`app.settingsPane` 默认值必须是 `account`，不要再引入 `'root'` 这类不在 `CATS` 里的值，否则右栏空白。
- **禁止用过期基线整体覆盖文件**：`js/ui.js`、`js/app.js`、`style.css` 都是多人在改的热点。改之前先 `git fetch && git log --oneline -3 -- <文件>`，确认自己的编辑基线是远端最新。曾发生社区功能提交（65209aa）基于过期版本整体替换 `settingsPage()`，把设置页两栏（`.set-layout`/`.ss-item`）和 `settingsPane='account'` 默认值一起回退。
- **改 `settingsPage()` 前后各 grep 一次**：`grep -c "set-layout\|ss-item\|set-main-head" js/ui.js` 必须 ≥ 1；`grep "settingsPane:" js/app.js` 必须是 `'account'`。为 0 或 'root' 说明又被覆盖了。
