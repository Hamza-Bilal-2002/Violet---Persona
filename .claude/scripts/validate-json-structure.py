"""
Validate that a modified JSON file preserves the exact structure of the original.
Checks: same keys (nested), same types, no added/removed keys, valid JSON,
interpolation variables preserved.

Useful after translation, humanization, or any transformation that should
preserve structure while changing string values.

Usage: python .claude/scripts/validate-json-structure.py <original.json> <modified.json>
Exit code 0 = PASS, 1 = FAIL

NOTE: This compares two SPECIFIC files. For batch locale directory parity,
use dictionary-diff.py instead.
"""

import json
import re
import sys


def extract_keys(obj, prefix=""):
    """Recursively extract all key paths and their value types."""
    keys = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            keys[path] = type(v).__name__
            if isinstance(v, (dict, list)):
                keys.update(extract_keys(v, path))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            path = f"{prefix}[{i}]"
            keys[path] = type(item).__name__
            if isinstance(item, (dict, list)):
                keys.update(extract_keys(item, path))
    return keys


def extract_interpolation_vars(obj, prefix=""):
    """Extract all {{variable}} patterns from string values."""
    variables = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            if isinstance(v, str):
                found = re.findall(r'\{\{[^}]+\}\}', v)
                if found:
                    variables[path] = sorted(found)
            elif isinstance(v, (dict, list)):
                variables.update(extract_interpolation_vars(v, path))
    elif isinstance(obj, list):
        for i, item in enumerate(obj):
            path = f"{prefix}[{i}]"
            if isinstance(item, str):
                found = re.findall(r'\{\{[^}]+\}\}', item)
                if found:
                    variables[path] = sorted(found)
            elif isinstance(item, (dict, list)):
                variables.update(extract_interpolation_vars(item, path))
    return variables


def main():
    if len(sys.argv) != 3:
        print("Usage: python validate-json-structure.py <original.json> <modified.json>")
        sys.exit(1)

    original_path = sys.argv[1]
    modified_path = sys.argv[2]
    errors = []

    # Load both files
    try:
        with open(original_path, 'r', encoding='utf-8') as f:
            original = json.load(f)
    except json.JSONDecodeError as e:
        print(f"FAIL: Original file is not valid JSON: {e}")
        sys.exit(1)

    try:
        with open(modified_path, 'r', encoding='utf-8') as f:
            modified = json.load(f)
    except json.JSONDecodeError as e:
        print(f"FAIL: Humanized file is not valid JSON: {e}")
        sys.exit(1)

    # Compare keys
    orig_keys = extract_keys(original)
    new_keys = extract_keys(modified)

    missing = set(orig_keys.keys()) - set(new_keys.keys())
    added = set(new_keys.keys()) - set(orig_keys.keys())

    if missing:
        errors.append(f"MISSING keys ({len(missing)}):")
        for k in sorted(missing):
            errors.append(f"  - {k}")

    if added:
        errors.append(f"ADDED keys ({len(added)}):")
        for k in sorted(added):
            errors.append(f"  + {k}")

    # Compare types at each key
    for key in sorted(set(orig_keys.keys()) & set(new_keys.keys())):
        if orig_keys[key] != new_keys[key]:
            errors.append(f"TYPE CHANGED at {key}: {orig_keys[key]} -> {new_keys[key]}")

    # Compare interpolation variables
    orig_vars = extract_interpolation_vars(original)
    new_vars = extract_interpolation_vars(modified)

    for path, orig_list in orig_vars.items():
        if path not in new_vars:
            errors.append(f"INTERPOLATION LOST at {path}: {orig_list} (key missing)")
        elif new_vars[path] != orig_list:
            errors.append(f"INTERPOLATION CHANGED at {path}: {orig_list} -> {new_vars[path]}")

    # Report
    print(f"=== JSON STRUCTURE VALIDATION ===")
    print(f"Original: {original_path}")
    print(f"Humanized: {modified_path}")
    print(f"Original keys: {len(orig_keys)}")
    print(f"Humanized keys: {len(new_keys)}")
    print()

    if errors:
        print(f"FAIL: {len(errors)} issue(s) found:")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("PASS: Structure matches. Same keys, same types, interpolation preserved.")
        sys.exit(0)


if __name__ == "__main__":
    main()
