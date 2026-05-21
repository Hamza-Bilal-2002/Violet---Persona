"""
Dictionary parity audit: compares JSON dictionary files across two locales.
Reports missing keys, extra keys, and type mismatches per file.

Usage:
    python .claude/scripts/dictionary-diff.py --source en --target de --dir dictionaries
    python .claude/scripts/dictionary-diff.py --source en --target fr --dir locales/dictionaries

Arguments:
    --source    Source locale code (default: en)
    --target    Target locale code (required)
    --dir       Path to dictionaries root (default: dictionaries)
    --report    Path for JSON report output (default: .claude/reports/dictionary-diff.json)

Exit code 0 = parity confirmed. Exit code 1 = discrepancies found.

NOTE: This script compares entire locale DIRECTORIES for batch parity.
For comparing two specific files, use validate-json-structure.py instead.
"""

import argparse
import json
import os
import sys
from pathlib import Path


def _find_project_root():
    for p in Path(__file__).resolve().parents:
        if (p / ".claude").is_dir():
            return p
    raise RuntimeError(f"Project root not found from {__file__}")


PROJECT_ROOT = _find_project_root()


def get_all_keys(obj, prefix=""):
    """Recursively collect all leaf key paths from a dict."""
    keys = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                keys.update(get_all_keys(v, path))
            else:
                keys[path] = type(v).__name__
    return keys


def compare_file(source_path, target_path, filename, source_label, target_label):
    """Compare a single pair of locale dictionary files."""
    result = {
        "file": filename,
        f"missing_in_{target_label}": [],
        f"extra_in_{target_label}": [],
        "type_mismatches": [],
    }

    if not os.path.exists(source_path):
        result["error"] = f"{source_label} file missing"
        return result
    if not os.path.exists(target_path):
        result["error"] = f"{target_label} file missing"
        return result

    with open(source_path, "r", encoding="utf-8") as f:
        source_data = json.load(f)
    with open(target_path, "r", encoding="utf-8") as f:
        target_data = json.load(f)

    source_keys = get_all_keys(source_data)
    target_keys = get_all_keys(target_data)

    for key in sorted(set(source_keys) - set(target_keys)):
        result[f"missing_in_{target_label}"].append(key)

    for key in sorted(set(target_keys) - set(source_keys)):
        result[f"extra_in_{target_label}"].append(key)

    for key in sorted(set(source_keys) & set(target_keys)):
        if source_keys[key] != target_keys[key]:
            result["type_mismatches"].append(
                {"key": key, f"{source_label}_type": source_keys[key], f"{target_label}_type": target_keys[key]}
            )

    return result


def main():
    parser = argparse.ArgumentParser(description="Dictionary parity audit across two locales.")
    parser.add_argument("--source", default="en", help="Source locale code (default: en)")
    parser.add_argument("--target", required=True, help="Target locale code (e.g., de, fr, ja)")
    parser.add_argument("--dir", default="dictionaries", help="Path to dictionaries root (default: dictionaries)")
    parser.add_argument("--report", default=None, help="Path for JSON report output")
    args = parser.parse_args()

    source_dir = os.path.join(args.dir, args.source)
    target_dir = os.path.join(args.dir, args.target)

    if not os.path.isdir(source_dir):
        print(f"ERROR: Source directory not found: {source_dir}", file=sys.stderr)
        sys.exit(1)
    if not os.path.isdir(target_dir):
        print(f"ERROR: Target directory not found: {target_dir}", file=sys.stderr)
        sys.exit(1)

    source_files = {f for f in os.listdir(source_dir) if f.endswith(".json")}
    target_files = {f for f in os.listdir(target_dir) if f.endswith(".json")}

    missing_key = f"missing_in_{args.target}"
    extra_key = f"extra_in_{args.target}"

    report = {
        "summary": {
            "source_locale": args.source,
            "target_locale": args.target,
            "source_files": len(source_files),
            "target_files": len(target_files),
            f"files_only_in_{args.source}": sorted(source_files - target_files),
            f"files_only_in_{args.target}": sorted(target_files - source_files),
            "total_missing_keys": 0,
            "total_extra_keys": 0,
            "total_type_mismatches": 0,
        },
        "files": [],
    }

    for filename in sorted(source_files | target_files):
        result = compare_file(
            os.path.join(source_dir, filename),
            os.path.join(target_dir, filename),
            filename,
            args.source,
            args.target,
        )
        report["files"].append(result)
        report["summary"]["total_missing_keys"] += len(result.get(missing_key, []))
        report["summary"]["total_extra_keys"] += len(result.get(extra_key, []))
        report["summary"]["total_type_mismatches"] += len(result.get("type_mismatches", []))

    # Write report
    report_path = args.report or str(PROJECT_ROOT / ".claude" / "reports" / "dictionary-diff.json")
    os.makedirs(os.path.dirname(report_path), exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    # Print summary
    s = report["summary"]
    print(f"{args.source} files: {s['source_files']}, {args.target} files: {s['target_files']}")
    if s[f"files_only_in_{args.source}"]:
        print(f"Files only in {args.source}: {s[f'files_only_in_{args.source}']}")
    if s[f"files_only_in_{args.target}"]:
        print(f"Files only in {args.target}: {s[f'files_only_in_{args.target}']}")
    print(f"Missing keys in {args.target}: {s['total_missing_keys']}")
    print(f"Extra keys in {args.target}: {s['total_extra_keys']}")
    print(f"Type mismatches: {s['total_type_mismatches']}")
    print(f"\nFull report: {report_path}")

    has_issues = s["total_missing_keys"] or s[f"files_only_in_{args.source}"] or s[f"files_only_in_{args.target}"]
    sys.exit(1 if has_issues else 0)


if __name__ == "__main__":
    main()
