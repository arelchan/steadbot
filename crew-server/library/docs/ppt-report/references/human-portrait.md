# Human Portrait / 人物画像 — 数据驱动一次成

> 适用：`human-portrait.html` 模板 — 「对象画像 / 能力拟人 / 风险热图」等需要
> **中央人体 + 周边标签 + 部位锚点**的页型。
>
> ⭐ **本页型已重构为一次成**：剪影 path、部位坐标、可见色点、引线连接
> 全部内置在 `assets/scripts/silhouette.js`，由 `renderHumanPortrait()` 渲染。
> 你**只写一段 labels 数据**，不再手画剪影、不再校准坐标、不再摆引线像素。

## 一、什么场景适合人物画像?

✓ **对象画像** — 典型客户 / 用户像谁（职业 / 动机 / 场景 / 地域 / 设备）
✓ **能力拟人化** — 把抽象能力（推理 / 视觉 / 语音 / 工具 / Agent）映射到身体部位
✓ **风险 / 影响热图** — 色点颜色深浅表示不同部位 / 职业受影响程度

✗ 不适合：纯数字关系（用散点 / 矩阵）；对象是产品 / 服务（用价值流 / 流程图）；
  讲故事不需要「人」做锚点。

## 二、怎么用（三步一次成）

### Step 1 · 拷模板

把 `assets/slides-templates/human-portrait.html` 拷成 `src/slides/slide-N.html`，
把 `sX` 改成页号（如 `s3`）、`initSlideX` 改成 `initSlide3`。

> ⚠ 占位符是 `sX`（不是 `sN`）—— 因为 `className` 里含子串 `sN`，
> 用 `sN` 当占位符做全局替换会误伤 JS。`sX` 不与任何标识符冲突，安全。
> 片段尾部的内联 `<style>` / `<script>` 由 `build.py` 自动抽取，不用手动拆文件。

### Step 2 · 只写 labels 数据

```js
function initSlide3() {
  renderHumanPortrait('#s3', {
    kind: 'man',                         // 'man' 西装提包 | 'woman' 长发职业
    labels: [
      { part: 'head',      num: '01', title: '职业 · 知识工作者', big: '68%',
        meta: '软件 / 咨询 / 金融', color: '#3b82f6', side: 'left' },
      { part: 'heart',     num: '02', title: '动机 · 工作生产力', big: '$22',
        meta: '月付意愿 · 71% 因提效', color: '#10b981', side: 'left' },
      { part: 'legs',      num: '03', title: '地域 · 北美+欧洲',  big: '62%',
        meta: '美国 38% · 欧洲 24%',  color: '#8b5cf6', side: 'left' },
      { part: 'shoulder',  num: '04', title: '使用 · 编程/写作',  big: '8.4×',
        meta: '日均对话 · Top3 占 73%', color: '#f59e0b', side: 'right' },
      { part: 'rightHand', num: '05', title: '设备 · Web+iOS',    big: '53%',
        meta: '桌面 32% · iOS 12%',   color: '#ec4899', side: 'right' },
    ],
  });
}
```

`renderHumanPortrait()` 自动完成：① 注入剪影 ② 按 `part` 查坐标表，在身体对应部位
画**可见色点**（实心点 + 白描边 + 淡光晕）③ 单程测量 DOM 几何，把**引线从色点连到标签卡**
（颜色与标签同色呼应）④ 按 `side` 把标签卡左右错落排布。

### Step 3 · build

`python3 build.py` → 预览。剪影 / 色点 / 引线一次到位，无需截图反复调坐标。

## 三、part 字段可选值（已内置坐标，无需校准）

剪影素材：OpenClipart CC0 — 男 [321053](https://openclipart.org/detail/321053/) 西装提包 ·
女 [310702](https://openclipart.org/detail/310702/) 长发职业。坐标表见
`silhouette.js` 的 `window.BODY_ANCHORS`。

| kind | part 可选值 |
|---|---|
| `man` | `head` 头 · `mouth` 嘴喉 · `heart` 胸/心 · `shoulder` 肩 · `leftHand` 左手 · `rightHand` 右手/提包 · `legs` 腿 · `feet` 脚 |
| `woman` | `head` 头 · `leftEye`/`rightEye` 眼 · `leftEar`/`rightEar` 耳 · `heart` 胸/心 · `leftHand`/`rightHand` 手 · `base` 半身底 |

> 想换剪影 / 微调锚点：改 `silhouette.js` 里 `SILHOUETTE`（path + viewBox）和
> `BODY_ANCHORS`（部位坐标，各自 viewBox 坐标系）即可，渲染逻辑不用动。

## 四、设计铁律（少而硬）

1. **标签 ≤ 6 个，左右各 ≤ 3 个**（5 个 = 左 3 右 2 最舒服）。多了视觉过载。
2. **每个标签必须绑定一个 `part`** → 色点画在对应部位、引线连过去。漏写 `part` 该标签无色点无引线。
3. **`color` 用语义色**：5 色 `#3b82f6 蓝 / #10b981 绿 / #8b5cf6 紫 / #f59e0b 橙 / #ec4899 粉`，
   引线 + 色点 + 标签左脊同色呼应。
4. **底部一句话总结**（`hp-foot`）含 1-3 个加粗关键数字——人体图本身没结论，靠文字告诉读者「所以呢」。
5. **一份 deck ≥ 2 张人像页时，`kind` 交替 man / woman** 避免重复。
   经典咨询搭配：男「西装提包」代表知识工作者，女「长发职业」适合能力展示。

## 五、为什么这样设计（踩坑沉淀）

- **剪影是「找+适配」不是「AI 画」**：LLM 手写 path 永远在头颈过渡踩坑。直接抄 OpenClipart
  CC0 剪影，path 一次性烘焙进 `silhouette.js`，之后零网络、零重画。详见 [`svg-aesthetics.md`](svg-aesthetics.md)。
- **色点 + 引线必须是 DOM 实测连接**：旧版把引线写死像素坐标（x=280/720），换标签数 / 换剪影就崩、
  且引线悬在半空没有锚点。新版色点是真实 SVG 元素，引线用 `getBoundingClientRect()` 单程测量
  「色点中心 ↔ 标签卡内缘」连线——布局怎么变都对齐，且永远有可见锚点。
  （这是单程测量画线，**不是** landscape 那种被禁的「循环测量反推字号」死结。）
- **viewBox 用素材原坐标系**：男 708×1066 / 女 2334×1638，色点坐标按各自 viewBox。
  剪影保留 OpenClipart 的双色（西装黑 + 肤色头手），比纯黑更有「咨询报告级」质感；
  传 `silhouette:{color:'#0f172a'}` 可强制单色。

## 六、配套自检

- [ ] 标签左右分布合理（5 个 = 左 3 右 2，不挤一边）
- [ ] 每个色点落在正确部位（头点在头上、心点在胸口，不飘空）
- [ ] 引线从标签连到色点、虚线柔和、颜色与标签呼应
- [ ] 底部一句话总结含 1-3 个加粗数字
- [ ] 截图缩到 30% 仍能识别人体形状（剪影测试）

---

> 配套模板：`assets/slides-templates/human-portrait.html`
> 共享资产：`assets/scripts/silhouette.js`（剪影 + 坐标 + 渲染，build 自动注入）
> 前置方法论：`references/svg-aesthetics.md`（SVG 美学 + 剪影「找+适配」5 步）
