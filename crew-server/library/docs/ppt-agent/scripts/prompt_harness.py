#!/usr/bin/env python3
"""Prompt template harness -- fill {{VAR}} placeholders and output ready-to-use prompt files.

Main agent calls this script to generate subagent prompts from templates.
This script does ONLY text transformation -- no scheduling, no subagent management.

Usage:
    python3 prompt_harness.py \
        --template path/to/tpl-outline-orchestrator.md \
        --var PAGE_NUM=3 \
        --var TOTAL_PAGES=12 \
        --inject-file PLAYBOOK=path/to/playbook.md \
        --output OUTPUT_DIR/runtime/prompt-page-3.md
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


VAR_PATTERN = re.compile(r"\{\{([A-Z_][A-Z0-9_]*)\}\}")


def parse_var_arg(raw: str) -> tuple[str, str]:
    """Parse KEY=VALUE from --var argument."""
    if "=" not in raw:
        print(f"ERROR: --var must be KEY=VALUE, got: {raw}", file=sys.stderr)
        sys.exit(1)
    key, _, value = raw.partition("=")
    key = key.strip()
    if not key:
        print(f"ERROR: empty key in --var: {raw}", file=sys.stderr)
        sys.exit(1)
    return key, value.strip()


def parse_inject_file_arg(raw: str) -> tuple[str, str]:
    """Parse KEY=path from --inject-file argument and read file content."""
    if "=" not in raw:
        print(f"ERROR: --inject-file must be KEY=PATH, got: {raw}", file=sys.stderr)
        sys.exit(1)
    key, _, filepath = raw.partition("=")
    key = key.strip()
    filepath = filepath.strip()
    if not key:
        print(f"ERROR: empty key in --inject-file: {raw}", file=sys.stderr)
        sys.exit(1)
    path = Path(filepath)
    if not path.exists():
        print(f"ERROR: inject-file path not found: {path}", file=sys.stderr)
        sys.exit(1)
    content = path.read_text(encoding="utf-8").strip()
    return key, content


def fill_template(template: str, variables: dict[str, str]) -> tuple[str, list[str]]:
    """Replace all {{VAR}} placeholders. Returns (filled_text, unfilled_vars)."""
    unfilled: list[str] = []

    def replacer(match: re.Match) -> str:
        var_name = match.group(1)
        if var_name in variables:
            return variables[var_name]
        unfilled.append(var_name)
        return match.group(0)  # keep original if not found

    result = VAR_PATTERN.sub(replacer, template)
    return result, unfilled


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fill prompt template variables and output ready-to-use prompt files"
    )
    parser.add_argument(
        "--template", required=True,
        help="Path to template file (e.g. references/prompts/tpl-outline-orchestrator.md)"
    )
    parser.add_argument(
        "--var", action="append", default=[],
        help="Variable assignment in KEY=VALUE format (repeatable)"
    )
    parser.add_argument(
        "--inject-file", action="append", default=[], dest="inject_files",
        help="Inject file content as variable in KEY=PATH format (repeatable)"
    )
    parser.add_argument(
        "--output", required=True,
        help="Output path for the filled prompt file"
    )
    parser.add_argument(
        "--allow-unfilled", action="store_true",
        help="Allow unfilled {{VAR}} without error (for debugging only)"
    )

    args = parser.parse_args()

    # Read template
    template_path = Path(args.template)
    if not template_path.exists():
        print(f"ERROR: template not found: {template_path}", file=sys.stderr)
        return 1
    template_text = template_path.read_text(encoding="utf-8")

    # Collect variables
    variables: dict[str, str] = {}

    for raw in args.var:
        key, value = parse_var_arg(raw)
        variables[key] = value

    for raw in args.inject_files:
        key, content = parse_inject_file_arg(raw)
        variables[key] = content

    # Fill template
    filled_text, unfilled = fill_template(template_text, variables)

    # Check for unfilled variables
    # Deduplicate unfilled list
    unfilled_unique = sorted(set(unfilled))
    if unfilled_unique and not args.allow_unfilled:
        print(f"ERROR: unfilled variables in template: {', '.join(unfilled_unique)}", file=sys.stderr)
        print(f"Template: {template_path}", file=sys.stderr)
        print(f"Provided variables: {', '.join(sorted(variables.keys()))}", file=sys.stderr)
        return 1

    if unfilled_unique and args.allow_unfilled:
        print(f"WARN: unfilled variables (allowed): {', '.join(unfilled_unique)}", file=sys.stderr)

    # Write output
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(filled_text, encoding="utf-8")

    print(f"Done: {template_path.name} -> {output_path}")
    print(f"  Variables filled: {len(variables)}")
    if unfilled_unique:
        print(f"  Unfilled (allowed): {len(unfilled_unique)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
