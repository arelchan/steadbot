"""
xlsx2json.py — 把 Excel/CSV 转成 ppt-report-generator 用的 JSON。

可作为独立调试工具单跑，也被 build.py 自动调用。

约定
----
1. 推荐新格式：每页一个文件夹 src/data/slide-N/
   - slide-N/kpis.xlsx    → window.__DATA_N__.kpis
   - slide-N/trend.csv    → window.__DATA_N__.trend
   - slide-N/cfg.json     → window.__DATA_N__.cfg
   文件名（不含扩展名）即为 JS 里的 key，多个文件可并列。
   同 key 优先级：.json > .xlsx > .csv

2. 旧格式仍完全兼容（向后兼容）：
   - src/data/slide-N.xlsx   多 sheet：每个 sheet → JSON 顶层一个 key
   - src/data/slide-N.csv    单表：整份 → JSON 顶层一个 array
   - src/data/slide-N.json   原生 JSON：直接读取
   build.py 优先找 slide-N/ 目录，没有才回退到单文件。

3. 每个 sheet / csv 的格式：
   第 1 行 = 表头，后续行 = 数据
   转换为 [ {col1: val, col2: val}, ... ]
   单元格中的数字自动转 number；其他保留字符串

4. 以 `_` 开头的 sheet 名、列名或文件名会被跳过

5. xlsx 单 sheet 自动解包：
   - kpis.xlsx 只有 1 个 sheet → window.__DATA_N__.kpis = [{...}]（数组，不套一层 key）
   - kpis.xlsx 有 2+ sheet → window.__DATA_N__.kpis = {monthly:[...], yearly:[...]}

用法
----
    # 新格式：转换单页目录（输出该页合并 JSON）
    python3 xlsx2json.py src/data/slide-2/

    # 旧格式：单文件转换（输出到 stdout）
    python3 xlsx2json.py src/data/slide-3.xlsx

    # 转换整个 data/ 目录（自动识别文件夹和单文件两种格式）
    python3 xlsx2json.py src/data/

依赖
----
- xlsx 支持：openpyxl（pip install openpyxl）
- csv / json：标准库

若 openpyxl 未安装，仅 csv / json 可用，xlsx 文件会被跳过并提示。
"""
from __future__ import annotations
import csv
import json
import sys
from pathlib import Path


def _coerce(v):
    """单元格值类型转换：数字 → number；空 → None；其他 → str."""
    if v is None:
        return None
    if isinstance(v, (int, float, bool)):
        return v
    s = str(v).strip()
    if s == '':
        return None
    # 尝试 int
    try:
        if '.' not in s and 'e' not in s.lower():
            return int(s)
    except ValueError:
        pass
    # 尝试 float
    try:
        return float(s)
    except ValueError:
        pass
    return s


def _rows_to_objects(rows):
    """[[header...], [row...], ...] → [{col: val}, ...]，过滤掉 _ 开头的列."""
    if not rows:
        return []
    header = [str(h).strip() if h is not None else '' for h in rows[0]]
    keep_cols = [i for i, h in enumerate(header) if h and not h.startswith('_')]
    out = []
    for row in rows[1:]:
        # 整行空则跳过
        if all(v is None or str(v).strip() == '' for v in row):
            continue
        obj = {}
        for i in keep_cols:
            if i < len(row):
                obj[header[i]] = _coerce(row[i])
            else:
                obj[header[i]] = None
        out.append(obj)
    return out


def xlsx_to_dict(path: Path) -> dict:
    """xlsx → {sheet_name: [rows]}，跳过 _ 开头的 sheet."""
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError(
            f'读取 {path.name} 需要 openpyxl。安装：pip install openpyxl'
        )
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    result = {}
    for sheet_name in wb.sheetnames:
        if sheet_name.startswith('_'):
            continue
        ws = wb[sheet_name]
        rows = [[c for c in row] for row in ws.iter_rows(values_only=True)]
        result[sheet_name] = _rows_to_objects(rows)
    wb.close()
    return result


def csv_to_list(path: Path) -> list:
    """csv → [{col: val}, ...]."""
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.reader(f)
        rows = list(reader)
    return _rows_to_objects(rows)


def convert_file(path: Path):
    """根据扩展名分派转换；返回 Python 对象或 None（跳过）."""
    suffix = path.suffix.lower()
    if suffix == '.json':
        return json.loads(path.read_text(encoding='utf-8'))
    if suffix == '.xlsx':
        return xlsx_to_dict(path)
    if suffix == '.csv':
        return csv_to_list(path)
    return None


def load_slide_dir(dir_path: Path) -> dict:
    """加载 slide-N/ 目录，返回 {文件名stem: 数据} 的合并 dict。

    每个文件的 stem（不含扩展名）成为 JS 里的 key：
      kpis.xlsx → key "kpis"，value = xlsx 数据
      trend.csv → key "trend"，value = csv list
      cfg.json  → key "cfg"，  value = json 原值

    xlsx 单 sheet 自动解包为 list；多 sheet 保留 {sheet: list} dict。
    同 stem 下优先级：.json > .xlsx > .csv
    以 '_' 开头的文件名跳过。
    """
    PRIORITY = {'.json': 0, '.xlsx': 1, '.csv': 2}
    by_stem: dict[str, tuple[int, Path]] = {}

    for p in sorted(dir_path.iterdir()):
        if not p.is_file():
            continue
        if p.name.startswith('.') or p.name.startswith('_') or p.stem.startswith('_'):
            continue
        suf = p.suffix.lower()
        if suf not in PRIORITY:
            continue
        prio = PRIORITY[suf]
        if p.stem not in by_stem or prio < by_stem[p.stem][0]:
            by_stem[p.stem] = (prio, p)

    result = {}
    for stem, (_, p) in sorted(by_stem.items()):
        try:
            obj = convert_file(p)
            if obj is None:
                continue
            # xlsx 单 sheet 自动解包：{sheet_name: rows} → rows
            if p.suffix.lower() == '.xlsx' and isinstance(obj, dict) and len(obj) == 1:
                obj = next(iter(obj.values()))
            result[stem] = obj
        except Exception as e:
            print(f'⚠  {p.name}: {e}', file=sys.stderr)
    return result


def convert_dir(d: Path) -> dict:
    """遍历 data/ 目录，返回 {slide_n: (source_label, obj)} 映射。

    优先级（每个 slide）：
      1. slide-N/  子目录（新格式，多数据源）
      2. slide-N.json / .xlsx / .csv（旧格式，向后兼容）
    """
    found: dict[int, tuple[str, object]] = {}

    # ── 新格式：slide-N/ 子目录 ──
    for p in sorted(d.iterdir()):
        if not p.is_dir() or p.name.startswith('.') or p.name.startswith('_'):
            continue
        if not p.name.startswith('slide-'):
            continue
        try:
            n = int(p.name[len('slide-'):])
        except ValueError:
            continue
        try:
            obj = load_slide_dir(p)
            if obj:
                found[n] = (f'slide-{n}/', obj)
        except Exception as e:
            print(f'⚠  {p.name}/: {e}', file=sys.stderr)

    # ── 旧格式：单文件（只在没有对应目录时处理）──
    PRIORITY = {'.json': 0, '.xlsx': 1, '.csv': 2}
    by_slide: dict[int, tuple[int, Path]] = {}
    for p in sorted(d.iterdir()):
        if not p.is_file() or p.name.startswith('.') or p.name.startswith('_'):
            continue
        if p.suffix.lower() not in PRIORITY:
            continue
        stem = p.stem
        if not stem.startswith('slide-'):
            continue
        try:
            n = int(stem[len('slide-'):])
        except ValueError:
            continue
        if n in found:          # 目录已处理，跳过同号单文件
            continue
        prio = PRIORITY[p.suffix.lower()]
        if n not in by_slide or prio < by_slide[n][0]:
            by_slide[n] = (prio, p)

    for n, (_, p) in sorted(by_slide.items()):
        try:
            obj = convert_file(p)
            if obj is not None:
                found[n] = (p.name, obj)
        except Exception as e:
            print(f'⚠  {p.name}: {e}', file=sys.stderr)

    return {n: v for n, v in sorted(found.items())}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    target = Path(sys.argv[1])
    if not target.exists():
        print(f'不存在：{target}', file=sys.stderr)
        sys.exit(1)

    if target.is_file():
        # 单文件
        obj = convert_file(target)
        if obj is None:
            print(f'不支持的文件类型：{target}', file=sys.stderr)
            sys.exit(1)
        json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')
    elif (target / 'slide-1.html').exists() or any(
        f.suffix.lower() in {'.xlsx', '.csv', '.json'}
        for f in target.iterdir() if f.is_file()
    ) or any(f.is_dir() and f.name.startswith('slide-') for f in target.iterdir()):
        # data/ 根目录（含文件 or 子目录）
        result = convert_dir(target)
        for n, (label, obj) in result.items():
            print(f'# slide-{n}  ({label})')
            json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
            sys.stdout.write('\n\n')
    else:
        # slide-N/ 子目录（单独调试一页）
        obj = load_slide_dir(target)
        if not obj:
            print(f'目录为空或无可识别的数据文件：{target}', file=sys.stderr)
            sys.exit(1)
        json.dump(obj, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write('\n')


if __name__ == '__main__':
    main()
