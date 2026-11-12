# dsh-script-hub 发布指南（仓库 + 插件市场）

作者：**dan yikona** · `dansensei2024@outlook.com`
本文说明两件事：**① 把插件传到 GitHub 仓库**，**② 让它出现在 DSH 的插件市场里**。

---

## 0. 先确认包里有什么

`dsh-script-hub-0.2.2.zip` 解压后是 6 个文件，平铺在根目录：

```
index.js            host 侧（路由 / 工具 / 归档 / 运行 / AI）
client.js           面板 UI（侧边栏 + 中间页）
cordis.patch.yml    bundle patch：往 profile 插插件行与默认配置
package.json        包元信息（name / version / dsh.engines）
icon.svg            面板图标
README.md           说明文档（顶部有权限声明）
```

**不要提交、不要打包**：`index.json`（含本机绝对路径与会话 id）、`logs/`（运行记录）、`node_modules/`。
仓库里建议加一份 `.gitignore`：

```gitignore
index.json
logs/
node_modules/
*.zip
```

---

## 1. 传到 GitHub 仓库

### 1.1 本地初始化

在 `script-hub/` 目录里执行（Git 需先装好，`git --version` 能出版本即可）：

```bash
cd /d/DeepSeek/script-hub          # 换成你放插件源码的目录
git init -b main
git add index.js client.js cordis.patch.yml package.json icon.svg README.md UPLOAD-GUIDE.md .gitignore
git commit -m "feat: dsh-script-hub 0.2.2 — 脚本归档 / 运行 / 文档 [dan yikona]"
```

### 1.2 建远程仓库并推送

1. 打开 <https://github.com/new>，仓库名建议 `dsh-script-hub`，**Public**（市场要读 README 与 Release），初始化选项全部不勾。
2. 回到终端：

```bash
git remote add origin https://github.com/<你的用户名>/dsh-script-hub.git
git push -u origin main
```

> 用 SSH 的话把 remote 换成 `git@github.com:<用户名>/dsh-script-hub.git`；第一次推送会要求登录，GitHub 现在要 **Personal Access Token** 当密码（Settings → Developer settings → Tokens (classic) → 勾 `repo`）。

### 1.3 打 tag + 放一个 Release（可选但推荐）

市场与用户都能从 Release 直接下 zip：

```bash
git tag -a v0.2.2 -m "dsh-script-hub 0.2.2 by dan yikona"
git push origin v0.2.2
```

然后在仓库页面 **Releases → Draft a new release**，选 `v0.2.2`，标题写 `0.2.2`，正文可用下面这段，附件拖入 `dsh-script-hub-0.2.2.zip`：

```markdown
## 0.2.2 — dan yikona

- 新增：一键检测重要性（多选 / 分批 20 条自动续跑）
- 新增：文档质量判定（骨架 / 空壳文档会被识别并排队补全）
- 新增：自动命名（作用短语 + 版本号 vN，按脚本生成来源排版本）
- 新增：生成会话归档 —— 插件开会话结束后调用官方 `workspaceRegistry.archiveSession()`，与你手动点「归档会话」等效（侧边栏移除，归档里可找回）；产物脚本同时回扫归档，会话存档另存一份到 `logs\sessions\`
- 新增：操作栏收敛为 启动 / 删除 / 更多，隐藏功能与「已隐藏(N)」筛选
- 新增：同名启动壳合并、虚拟滚动
- 优化：/list 首次 15.5s → 0.14s，稳态 10ms；面板只渲染可视行
- 修复：PowerShell 5.1 读无 BOM 的 UTF-8 脚本会吞掉下一行
- 0.2.2：新增顶部「操作 ▾」批量入口（启动 / 停止 / 补文档 / 检测重要性 / 隐藏 / 复制路径 / 删除选中）
- 0.2.2：修复窗口缩小后文档/日志预览区被裁掉（表格 `flex:1` 自适应 + `ResizeObserver`，详情区 `clamp(150px,34vh,320px)`）
```

### 1.4 仓库要放的文件清单

| 文件 | 必须 | 说明 |
| --- | --- | --- |
| `package.json` | ✅ | 市场按它读包名、版本、`dsh.engines.dsh` 兼容区间 |
| `README.md` | ✅ | 市场卡片与详情页会渲染它，顶部权限声明请保留 |
| `index.js` / `client.js` | ✅ | 宿主与前端入口，`package.json` 的 `exports` 已指向它们 |
| `cordis.patch.yml` | ✅ | 没有它插件装不进 profile |
| `LICENSE` | 建议 | 现在 README 写的是 MIT，可以补一份标准 MIT 文本 |
| `icon.svg` | 建议 | 面板图标；没有就用默认图标 |

---

## 2. 上架 DSH 插件市场

DSH 的插件市场（`dshmarket`）**不自己维护列表**，它的目录来自社区精选仓库
[`awesome-dsh-plugin/awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：
往那边提一个 PR、加一条记录，**市场与网站会自动收录，通常一天内生效**。
（市场作者在 README 里明确写了：请勿往 `dsh-market` 市场应用仓库提插件条目。）

### 2.1 前置：让插件能被「一键安装」

市场的一键安装需要两个来源之一，**推荐第一条**：

**A. 发布到 npm（最顺）**

```bash
npm login                       # 没账号先去 npmjs.com 注册
npm view dsh-script-hub         # 先查包名是否被占用
npm publish --access public
```

- 包名被占：把 `package.json` 的 `name` 改成 `@<你的npm用户名>/dsh-script-hub`，再 publish。
- 发版流程：改 `version` → `git commit` → `npm publish` → `git tag`。
- 国内网络可先 `npm config set registry https://registry.npmmirror.com` 再发（发布仍走官方源，建议只对拉取换镜像）。

**B. 只靠 GitHub**：仓库公开 + Release 带 zip 附件也能被市场识别（"GitHub-only entries"），
但更新、版本对齐不如 npm 稳，长期还是建议发 npm。

### 2.2 提 PR 加一条目录记录

1. Fork `awesome-dsh-plugin/awesome-dsh-plugin`。
2. 在他们列表的合适分类里加**一条**（格式照抄邻居条目，字段通常就是：插件名 / 一句话简介 / 仓库链接 / npm 包名 / 分类标签）。示例：

```markdown
- [dsh-script-hub](https://github.com/<你的用户名>/dsh-script-hub) — 把会话里写出的脚本自动归档成可查可跑可写文档的资产库，带侧边栏面板（启动/停止/日志/AI 补全文档/重要性/自动命名）。`npm i dsh-script-hub`
```

3. 开 PR，标题 `Add dsh-script-hub`，描述里写清楚：做什么、需要什么权限（本插件会跑脚本，务必写）、支持平台（Windows）。
4. 合入后：市场里搜索 `script-hub` 即可看到；网站 `awesome-dsh-plugin.com` 同步出现。

### 2.3 上架后的验证

- **市场**：DSH 里打开 **插件 → 插件市场（Plugin Market）**，搜索 `script-hub`，点安装；装完刷新页面，侧边栏出现「脚本中心」。
- **命令行装**（不经市场也能验）：
  ```bash
  dsh plugin --profile desktop add dsh-script-hub
  ```
  （profile 名以你宿主的为准，桌面版一般由应用自己的插件管理器接管，优先用面板装。）
- **索引直连**：插件 → 发现（Discover）→ 索引源，添加
  `https://cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`，宿主与 `plugin_market` 工具都能搜到同一份目录。

### 2.4 常见卡点

| 现象 | 原因 / 处理 |
| --- | --- |
| 市场里搜不到 | PR 还没合入（通常 1 天内）；或条目里的包名与 npm 实际包名不一致 |
| 装了但侧边栏没出现 | 版本要求没满足：`package.json` 里 `dsh.engines.dsh` 与 `peerDependencies` 写的是 `>=0.2.1-rc.3`，宿主要满足；再刷新页面 |
| 装完报「无法加载」 | 多半是 `cordis.patch.yml` 与 `package.json` 的 `exports` 对不上；用 `dsh plugin ... add` 看宿主日志的第一行错误 |
| 卡片没有截图 | 市场支持作者自带截图：README 里放 `![shot](https://…png)`（图片需 HTTPS 且由 GitHub 托管），或按市场文档在条目里加 screenshots 字段 |
| 更新检测不生效 | npm 上的 `version` 没涨；涨版本后市场才会提示「更新内容」 |

---

## 3. 一次性核对清单

- [ ] `package.json`：`name` / `version` / `author` / `license` 正确，`dsh.engines.dsh` 写了
- [ ] 仓库里没有 `index.json`、`logs/`、本机绝对路径
- [ ] README 顶部保留「⚠️ 权限声明」，作者签名 `dan yikona` 与邮箱在
- [ ] 打了 `v0.2.2` tag，Release 附了 zip
- [ ] npm 发布成功（`npm view <包名> version` 能看到 0.2.2）
- [ ] 向 `awesome-dsh-plugin` 提了 PR，描述里写清了「会跑脚本」这条权限
- [ ] 自己在干净机器上装一遍，确认侧边栏 → 脚本中心 → 手动归档/启动/日志都通

---

<sub>dsh-script-hub 发布指南 · dan yikona · dansensei2024@outlook.com</sub>
