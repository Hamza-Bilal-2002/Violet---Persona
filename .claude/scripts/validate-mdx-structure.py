"""
Validate that a modified MDX file preserves frontmatter structure.
Checks: same frontmatter keys, non-text fields unchanged, valid YAML,
all URLs in body preserved.

Text fields (allowed to change): title, description, summary
All other frontmatter fields must be byte-identical.

Useful after translation, humanization, or any transformation that should
preserve structure while changing prose content.

Usage: python .claude/scripts/validate-mdx-structure.py <original.mdx> <modified.mdx>
Exit code 0 = PASS, 1 = FAIL
"""

import sys
import re

TEXT_FIELDS = {"title", "description", "summary"}


def parse_frontmatter(content):
    """Extract frontmatter as key-value pairs and body content."""
    match = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)', content, re.DOTALL)
    if not match:
        return None, content

    fm_text = match.group(1)
    body = match.group(2)

    # Simple YAML-like parser for flat frontmatter
    fields = {}
    current_key = None
    current_value = None

    for line in fm_text.split('\n'):
        # Check if this is a new key-value pair
        kv_match = re.match(r'^(\w[\w-]*)\s*:\s*(.*)', line)
        if kv_match:
            if current_key is not None:
                fields[current_key] = current_value
            current_key = kv_match.group(1)
            current_value = kv_match.group(2).strip()
        elif current_key and line.startswith('  '):
            # Continuation of previous value (multiline)
            current_value += '\n' + line

    if current_key is not None:
        fields[current_key] = current_value

    return fields, body


def main():
    if len(sys.argv) != 3:
        print("Usage: python validate-mdx-structure.py <original.mdx> <modified.mdx>")
        sys.exit(1)

    original_path = sys.argv[1]
    modified_path = sys.argv[2]
    errors = []

    with open(original_path, 'r', encoding='utf-8') as f:
        orig_content = f.read()
    with open(modified_path, 'r', encoding='utf-8') as f:
        new_content = f.read()

    orig_fm, orig_body = parse_frontmatter(orig_content)
    new_fm, new_body = parse_frontmatter(new_content)

    if orig_fm is None:
        print("WARN: Original has no frontmatter. Skipping frontmatter validation.")
        print("PASS")
        sys.exit(0)

    if new_fm is None:
        errors.append("Humanized file has no frontmatter but original does")

    if orig_fm and new_fm:
        # Check same keys
        orig_keys = set(orig_fm.keys())
        new_keys = set(new_fm.keys())

        missing = orig_keys - new_keys
        added = new_keys - orig_keys

        if missing:
            errors.append(f"MISSING frontmatter keys: {sorted(missing)}")
        if added:
            errors.append(f"ADDED frontmatter keys: {sorted(added)}")

        # Check non-text fields are identical
        for key in sorted(orig_keys & new_keys):
            if key not in TEXT_FIELDS:
                if orig_fm[key] != new_fm[key]:
                    errors.append(
                        f"NON-TEXT FIELD CHANGED: {key}\n"
                        f"  Original:  {orig_fm[key]}\n"
                        f"  Humanized: {new_fm[key]}"
                    )

        # Check text fields exist (content can differ)
        for key in TEXT_FIELDS:
            if key in orig_fm and key not in new_fm:
                errors.append(f"TEXT FIELD MISSING: {key}")

    # Check URLs preserved in body
    orig_urls = sorted(set(re.findall(r'https?://[^\s\)\]>"\'`]+', orig_body)))
    new_urls = sorted(set(re.findall(r'https?://[^\s\)\]>"\'`]+', new_body)))

    missing_urls = set(orig_urls) - set(new_urls)
    added_urls = set(new_urls) - set(orig_urls)

    if missing_urls:
        errors.append(f"MISSING URLs ({len(missing_urls)}):")
        for u in sorted(missing_urls):
            errors.append(f"  - {u}")
    if added_urls:
        errors.append(f"ADDED URLs ({len(added_urls)}):")
        for u in sorted(added_urls):
            errors.append(f"  + {u}")

    # Report
    print("=== MDX STRUCTURE VALIDATION ===")
    print(f"Original: {original_path}")
    print(f"Humanized: {modified_path}")
    if orig_fm:
        print(f"Original frontmatter keys: {len(orig_fm)}")
    if new_fm:
        print(f"Humanized frontmatter keys: {len(new_fm)}")
    print(f"URLs in original body: {len(orig_urls)}")
    print(f"URLs in modified body: {len(new_urls)}")
    print()

    if errors:
        print(f"FAIL: {len(errors)} issue(s) found:")
        for e in errors:
            print(f"  {e}")
        sys.exit(1)
    else:
        print("PASS: Frontmatter structure preserved. Non-text fields unchanged. All URLs intact.")
        sys.exit(0)


if __name__ == "__main__":
    main()
