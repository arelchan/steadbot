"""font_resolver 拉黑语义回归测试（纯 Python，monkeypatch 网络层）。

- 网络类临时失败（断网 / 超时 / 5xx）不得把家族持久化标记为 not-in-google-fonts
- 真 404 才写入拉黑索引
"""
import json
import urllib.error

import font_resolver as fr


def _read_idx(path):
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def test_offline_does_not_blacklist(monkeypatch, tmp_path):
    idx_path = tmp_path / "_resolved.json"
    monkeypatch.setattr(fr, "RESOLVED_INDEX", idx_path)

    def offline(*a, **k):
        raise urllib.error.URLError("simulated offline")

    monkeypatch.setattr(fr.urllib.request, "urlopen", offline)
    report = fr.resolve_fonts({"Zz Test Family": {(400, False)}}, set())
    assert "Zz Test Family" in report["unavailable"]
    assert "zz test family" not in _read_idx(idx_path), \
        "一次离线运行不得把字体永久拉黑"


def test_http_404_blacklists(monkeypatch, tmp_path):
    idx_path = tmp_path / "_resolved.json"
    monkeypatch.setattr(fr, "RESOLVED_INDEX", idx_path)

    def gone(req, *a, **k):
        raise urllib.error.HTTPError("http://x", 404, "not found", {}, None)

    monkeypatch.setattr(fr.urllib.request, "urlopen", gone)
    report = fr.resolve_fonts({"Zz Test Family": {(400, False)}}, set())
    assert "Zz Test Family" in report["unavailable"]
    assert _read_idx(idx_path).get("zz test family") == "not-in-google-fonts"


def test_http_5xx_does_not_blacklist(monkeypatch, tmp_path):
    idx_path = tmp_path / "_resolved.json"
    monkeypatch.setattr(fr, "RESOLVED_INDEX", idx_path)

    def boom(req, *a, **k):
        raise urllib.error.HTTPError("http://x", 503, "unavailable", {}, None)

    monkeypatch.setattr(fr.urllib.request, "urlopen", boom)
    report = fr.resolve_fonts({"Zz Test Family": {(400, False)}}, set())
    assert "Zz Test Family" in report["unavailable"]
    assert "zz test family" not in _read_idx(idx_path)
