"""
sync.py — Core sync engine.
Copies root source tree → .claude/, respecting the protect list.
"""

import argparse
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INSTANCE = os.path.join(ROOT, ".claude")

SOURCE_DIRS = ["agents", "skills", "scripts", "rules"]
SOURCE_FILES = ["AGENTS.md", "settings.json"]

SKIP_PATTERNS = {"__pycache__"}

PROTECTED = [
    "AGENTS.md",
    os.path.join("agents", "fullstack-engineer.md"),
    os.path.join("agents", "content-editor.md"),
    os.path.join("skills", "test-strategy", "SKILL.md"),
    os.path.join("skills", "translator", "SKILL.md"),
    os.path.join("skills", "translator", "references", "terminology-glossary.md"),
    os.path.join("skills", "translator", "references", "i18n-de.md"),
    "settings.json",
]

INSTANCE_ONLY = {
    "settings.local.json",
    ".onboarded",
}


def should_skip(name):
    return name in SKIP_PATTERNS or name.endswith(".pyc")


def is_protected(relpath, force):
    if force:
        return False
    normalized = relpath.replace("\\", "/")
    return normalized in {p.replace("\\", "/") for p in PROTECTED}


def sync_file(relpath, force=False, dry_run=False):
    if os.path.isabs(relpath):
        print(f"  SKIP (absolute path not allowed): {relpath}")
        return False

    src = os.path.normpath(os.path.join(ROOT, relpath))
    dst = os.path.normpath(os.path.join(INSTANCE, relpath))

    if not src.startswith(os.path.normpath(ROOT) + os.sep):
        print(f"  SKIP (path escapes root): {relpath}")
        return False
    if not dst.startswith(os.path.normpath(INSTANCE) + os.sep):
        print(f"  SKIP (path escapes instance): {relpath}")
        return False

    if relpath.replace("\\", "/") in INSTANCE_ONLY:
        print(f"  SKIP (instance-only): {relpath}")
        return False

    if not os.path.exists(src):
        print(f"  SKIP (missing source): {relpath}")
        return False

    if is_protected(relpath, force) and os.path.exists(dst):
        print(f"  PROTECTED (exists): {relpath}")
        return False

    if dry_run:
        print(f"  WOULD SYNC: {relpath}")
        return True

    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copy2(src, dst)
    print(f"  SYNCED: {relpath}")
    return True


def sync_dir(dirname, force=False, dry_run=False):
    src_dir = os.path.join(ROOT, dirname)
    count = 0
    for dirpath, dirnames, filenames in os.walk(src_dir):
        dirnames[:] = [d for d in dirnames if not should_skip(d)]
        for fname in filenames:
            if should_skip(fname):
                continue
            full = os.path.join(dirpath, fname)
            relpath = os.path.relpath(full, ROOT)
            if sync_file(relpath, force, dry_run):
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description="Sync root source -> .claude/")
    parser.add_argument("--force", action="store_true", help="Overwrite protected files")
    parser.add_argument("--dry-run", action="store_true", help="Show what would sync without writing")
    parser.add_argument("--file", metavar="RELPATH", help="Sync a single file by relative path")
    args = parser.parse_args()

    os.makedirs(INSTANCE, exist_ok=True)

    if args.file:
        print(f"Syncing single file: {args.file}")
        sync_file(args.file, args.force, args.dry_run)
        return

    print("Syncing root source -> .claude/")
    total = 0

    for f in SOURCE_FILES:
        if sync_file(f, args.force, args.dry_run):
            total += 1

    for d in SOURCE_DIRS:
        total += sync_dir(d, args.force, args.dry_run)

    print(f"\nDone. {total} file(s) synced.")


if __name__ == "__main__":
    main()
