# Codex 审计报告 & MV 匹配优化记录

> 更新时间: 2026-05-01 23:00

---

## 一、Codex 代码重构问题记录

### 1.1 服务端架构重构（失败案例）

Codex 尝试将 `server.js`（~400行）拆分为模块化架构：

```
预期结构（Codex 生成）:
├── server.js          # 入口文件
├── lib/
│   ├── errors.js      # 统一错误处理
│   ├── http.js        # HTTP 工具
│   ├── logger.js      # 日志
│   └── security.js    # 安全中间件
├── routes/
│   ├── netease.js     # 网易云路由
│   ├── kuwo.js        # 酷我路由
│   ├── bilibili.js    # B站路由
│   └── proxy.js       # 代理路由
```

**遇到的问题:**

| 问题 | 影响 | 原因 |
|------|------|------|
| P0 安全修复导致播放失败 | Kuwo/网易云无法播歌 | proxy 函数修改后 CORS 处理不当 |
| jsonFetch 函数无超时 | 外部 API 请求卡死 | `fetch()` 没加 AbortController |
| server.js 拆分后功能异常 | 音频代理、B站搜索失效 | 拆分不完整，路由注册顺序错误 |
| 前端模块化拆分后引用错误 | `apiFetch` not defined | Codex 拆分时遗漏 import |

**结论:** Codex 的模块化拆分需要手动调试，不能直接信任生成代码。建议 `git reset --hard` 回滚后只做最小修改。

### 1.2 前端重构问题

Codex 将 `js/app.js` 拆分为：
- `js/api.js` — API 请求模块
- `js/player.js` — 播放器工具
- `js/ui.js` — UI 渲染
- `js/app.js` — 主入口（ES module）

**问题:**
- Bilibili MV 搜索被重写为 B站官方 API 优先（境外服务器被屏蔽，全部超时）
- `fetchBiliMV` 中被引入 `apiFetch` 但未正确 import
- 歌词渲染中 `innerHTML` 修复引入双代理问题

---

## 二、MV 匹配搜索优化历程

### 2.1 搜索源

使用 yaohud API (`api.yaohud.cn/api/v5/bilibili`)：
- `n` 参数（1-8）：控制返回结果的排序位置
- 不加 `n`：返回 8 条结果的列表（有标题、无 BV 号）
- 注意: **不加 n 的列表和加 n 的详情返回的结果不对应**（索引不一致）

### 2.2 优化迭代

#### V1 — 原始版（`git reset --hard fa1f25d` 前）
- 尝试 n=1..3，取第一个有 BV 的结果
- **问题:** 总是取到 n=1，对日文歌曲匹配率低

#### V2 — n=1..8 评分遍历
- 遍历 n=1..8，用评分函数选最佳
- 评分: 歌名+60, MV+30, 本家+20, 伴奏翻唱-90
- **问题:** 太慢（8次顺序请求，~24s）

#### V3 — 词边界检测（失败）
- 用正则/词边界检测避免"不滅のアルマ"误匹配"ルマ"
- **问题:** CJK 括号(`》《` `『』`)未被识别为词边界，导致正确结果也被过滤

#### V4 — 并行组请求（当前最优）
```javascript
// 并行请求组
groups = [[1,2,3], [4,5,6], [7,8]];
```
- 组1并行请求 3 个 n，2-3 秒返回
- 90% 歌曲在组1命中
- 标题必须包含搜索词才返回

### 2.3 当前评分规则

```
歌名匹配       +60
MV/2DMV/官方   +30
本家投稿       +20
初音/鏡音等    +15
翻唱/cover     -30（除非up主=歌手）
伴奏/卡拉OK    -50
```

### 2.4 已知限制

1. **yaohud API 不稳定:** n 值与列表索引不对应，详情与列表可能返回不同结果
2. **Bilibili 内容限制:** 部分歌曲（如 Project Sekai / Vocaloid 小众曲）B站没有或标题不同
3. **境外访问限制:** B站官方 API 在海外可能被屏蔽
4. **日文歌曲:** 搜索词不含 MV 后缀时匹配率更高
5. **翻唱判断:** 需根据 up 主名和歌手名匹配判断，不能一概而论

---

## 三、安全修复记录 (P0)

| 问题 | 修复状态 | 说明 |
|------|---------|------|
| API key 硬编码 | ✅ | 改为 `KUWO_API_KEY` 环境变量 |
| CORS 全开放 | ✅ | 已恢复为 `cors()` 默认 |
| 代理 SSRF | ✅ | `/api/kuwo/audio` 白名单检查 |
| execSync(curl) | ✅ | 已移除，改用 fetch/https |
| 歌词 XSS | ✅ | `innerHTML` → `textContent` |
| 请求超时 | ⚠️ | `jsonFetch` 未设 AbortController |

---

## 四、还原指南

```bash
# 回滚到 Codex 修改前的版本
cd /home/akuai/claw_work/music_video/test
git reset --hard fa1f25d

# MV 搜索优化已手动应用到 server.js 和 js/app.js
# 不要信任 Codex 的完整重构
```
