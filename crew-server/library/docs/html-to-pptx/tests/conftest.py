"""pytest 共享配置：把 skill 根目录 + scripts/ 加进 sys.path。

运行：python -m pytest tests -q   （需要 requirements.txt 依赖；浏览器类测试
额外需要 playwright chromium，不可用时自动 skip）
"""
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
for p in (str(ROOT), str(ROOT / "scripts")):
    if p not in sys.path:
        sys.path.insert(0, p)
