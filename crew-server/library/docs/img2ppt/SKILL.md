---
name: img2ppt-lite
description: 效果图 PNG/JPG → 可编辑 PPTX 轻量通用管线：文本原生可编辑 + 图案按语义切分为可拖拽贴图 + inpaint 干净底图。执行 agent 自身当 VLM（看图写 elements.json），本地脚本确定性完成 OCR校准/切图/装配/渲染验证；LLM 参与固定 2 次、COM 渲染 1 次、禁多轮收敛，单页目标 3-5 分钟。可被 Claude/Codex/Kimi 任何能读图+跑命令的 CLI agent 执行。触发词：img2ppt-lite、图转可编辑PPT、效果图转PPT。
---

# img2ppt-lite：效果图 → 可编辑 PPTX

产物结构 = **干净底图**（inpaint 去前景）+ **语义元素贴图**（独立 picture，可拖拽缩放）+ **原生文本框**（可编辑）+ 可选纯色圆角矩形原生化。视觉一致性来源：贴图直接裁自原图（天然 1:1），唯一会漂的文本层用 PIL 预拟合字号兜住，因此**不需要收敛循环**。

## 用户偏好铁律

1. 一切可读文本 → 原生 textbox（改字是最高频操作）。
2. 图案 icon/图表/插画 → 语义颗粒度独立贴图；**禁半页打包**（单贴图 >35% 页面积 = validate WARN）。
3. 不追求原生重构几何；仅"肉眼纯色的矩形色块"顺手原生化（可改色，成本≈0）。
4. 修补 ≤2 轮，之后如实交付并报告残留。禁无上限迭代。

## 工作流（5 步）

工作区 `<RUNS_ROOT>\<YYYYMMDD>-<name>\`（默认 `~\ppt-lite\runs`，环境变量 `IMG2PPT_RUNS` 可覆盖），源图复制为 `source.png`。
脚本目录 `SCRIPTS = <本 skill 所在目录>\scripts`。

```
1. `python SCRIPTS\pipeline.py --run <run> --seed`：冷启动 OCR 先写 `elements.seed.json`（绝不覆盖正式标注）。
2. [agent] Read source.png + seed：纠正 OCR；图/图表内部文字改 `text_in_graphic`；删噪声；补 card/graphic/漏字；另存 `elements.json` 并将 `seed.review_required=false`。禁止从零重抄 OCR 已给出的 bbox。
3. `python SCRIPTS\pipeline.py --run <run>`          # ocr校准 → 切图 → 装配 → COM渲染+验收
   常用开关：--font "Noto Sans SC" | --fast(跳过渲染) | --no-ref(不加参考页) | --no-ocr
3.5. tig 密集页（可选）：`python SCRIPTS\upgrade_tig.py --run <run>` 自动评估升级——OCR 供候选文字与准确墨界框，底质均匀（非字形残余 std<18）才升级，其余保留锁定。运行后写入 `tig_upgrade.review_required=true`，pipeline **硬停止**；必须逐项校对 `work\upgrade-tig.json` 与 `elements.json`（OCR 错字率高，实测 17 项 6 项错字），确认后手工设 `tig_upgrade.review_required=false`。漏检项由 agent 读图自补 text/bbox 后再跑步骤 3。
4. [agent] Read `work\compare.png` 与 `clean_text.png` 原始清晰度大图 + validate。展示标题仍有淡色幽灵时，仅对该 text 设 `mask_tolerance_bg:8~15`，禁全页暴力降阈值。
5. 有明显问题 → 改 elements.json → `--fast` 秒级修补；确认后只做一次最终 COM 回渲。总修补 ≤2 轮。交付 PPTX + validate + text_in_graphic 清单 + compare + `work\timing.json`；另报从复制源图到交付的人工墙钟时间。
```

首次使用/换机器先自检：`python SCRIPTS\pipeline.py --selftest`（合成样张全链路真跑+COM 渲染）。

## elements.json schema

```json
{"img_w": 1792, "img_h": 1024, "font": "Microsoft YaHei",
 "elements": [
  {"id":"t1","type":"text","bbox":[x0,y0,x1,y1],"text":"季度营收 +37%","color":"#1D1D1F",
   "bold":true,"align":"left","line_spacing":1.15,"group":"hero"},
  {"id":"c1","type":"card","bbox":[...],"radius":14,"stroke":"#D8E6FA","stroke_width":1,"group":"kpi"},
  {"id":"g1","type":"graphic","bbox":[...],"desc":"火箭icon","alpha":true,"parent":"c1"},
  {"id":"x1","type":"text_in_graphic","bbox":[...]}
 ]}
```

- `text`：bbox 是文字**墨水紧界**（不含留白）；每个视觉行/语义段一个元素（多行正文才用 `\n`+line_spacing）；color 取文字主色；bold 看笔画粗细。脚本用**背景相对检测**抹除文字像素，阈值按本框底噪在 18~45 自适应，兼顾 AA 幽灵与底图保护；掩码 bbox 自动取 refined 框与 agent 框并集。展示标题残影可单项设 `mask_tolerance_bg:8~15`，检测遇阻可 `mask_mode:"bbox"`。两个自动测量（均可覆盖）：**渐变字**（≥28px 展示级短文字）与**墨色自校准**（偏差 >40 时以实测墨芯色为准，`"color_locked":true` 锁定）。
- **行首 marker 双向规则**（■/•/图例色块）：text **不含** marker 字符时，行首"异色实心块"（legend 色块、彩色 bullet）自动生成独立 `graphic` 语义贴图（`auto_marker_for` + `marker_sprite_ids`），即使位于原生 card 内也不会被清底擦掉，并可单独拖拽；靠尺寸+填充率+行首+与字形间隙+异于文字色五重判据识别。text **含** marker 字符（如 "■ 标题"）时掩码左扩抹掉原 marker 并原生重建。默认前者保颜色 1:1；只有 marker 必须跟文字一起改色/改字时才写进 text。
- `ocr_locked: true`：该 text 元素跳过 OCR 校准。用于 OCR 框系统性偏移的行（如行首含 icon 被框进）——手工修正 bbox 后必须加锁，否则重跑会被 OCR 拉回错误框。
- `card`：肉眼纯色（或近纯色）矩形/圆角矩形色块 → 原生 shape。脚本会实测验证纯色并自动取色（自动避开压在上面的文字）；不纯 → 自动降级 graphic。渐变/纹理色块直接标 graphic；确定只是抗锯齿/阴影导致方差偏高时可 `force_native:true`，可选 `stroke`/`stroke_width`。
- `graphic`：一个 icon / 一个 logo / 一张图表 / 一段装饰线 = 一个元素，从原图裁贴图。`alpha:true` 仅用于落在纯色背景上的小 icon（底色转透明，拖动更自然）；照片/图表/复杂底一律 false。
- 嵌套元素必须写 `parent`（如卡片中的 icon、编号圆中的数字）：父贴图会自动扣掉已单列子元素，避免移动时带走重复副本。
- `text_in_graphic`：长在图案内部的小文字（图表轴标、数据标注）→ 只标记 bbox，保留在贴图里不抠不建（inpaint 会绕开它）。需可编辑化时走 `upgrade_tig.py` 安全评估升级（白底/均匀底标签、页码徽章大多可升），勿徒手逐个转。
- z 序 = 数组顺序（底图 → card → graphic → text 自动分层，同层内按数组序）。
- bbox 尽量准但有容错：文本 bbox 会被本地 OCR 在**空间邻域内唯一匹配**校准（重复标签不会串位），OCR 结果按源图 SHA256 缓存；graphic 裁剪自带 2px pad。
- `elements.seed.json` 与 `upgrade_tig.py` 结果都只是候选；任一 `review_required=true` 时 pipeline 硬停止，防止 OCR 错字或图内文字被误当 native 直接交付。

## 硬规则（继承前代管线血泪，违反必翻车）

1. **字号禁一切启发式**——由脚本 PIL 墨水高度反解，agent 不填字号。
2. **中文字体三件套**：latin + a:ea + a:cs 全设（脚本已内置）；validate 自动查 `??`/乱码。
3. **COM 纪律**：ReadOnly + WithWindow=False；先记录已有 POWERPNT PID，再用进程差分证明实例归属，只关闭本次打开的文稿，且仅 Quit 被证明为新建独占的实例；**绝不 kill / Quit 用户已有 PowerPoint**。
4. 所有原生 shape `shadow.inherit=False`（脚本已内置）。
5. 窄数字/条状文本：脚本自动取高度解与宽度解的较小值。
6. 交付双字体默认关闭；主产物微软雅黑（跨机安全），需要其他字形再 `--font "Noto Sans SC"`。

## 交付定义

- `<name>.pptx`（页1=可编辑重建；页2=原图参考页，`--no-ref` 关）绝对路径
- validate 摘要（原生文本覆盖率 / 语义对象覆盖率 / 原生卡片数 / 贴图数及最大占比 / 乱码检查 / COM 渲染是否执行与实例归属）
- 如实报告：text_in_graphic 清单（哪些文字锁在贴图里）、降级的 card、未达项
