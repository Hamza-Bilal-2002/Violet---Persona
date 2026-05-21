---
name: compare
description: Open two files side by side in VSCodium diff view. Use when comparing original vs modified, before vs after, or any two files.
argument-hint: <file1> <file2>
compatibility: Requires VSCodium installed and on PATH
---

Open a diff view in VSCodium comparing two files.

## Steps

1. **Resolve paths.** If two file paths are provided as arguments, use them. If a general description is provided (e.g. "cat", "original home.json vs humanized"), search the codebase to find the correct file paths. Use Glob to find matches.

2. **Validate both files exist.** Use Bash `ls` to confirm both files are real. If either file does not exist, tell the user which file was not found and suggest alternatives from the same directory.

3. **Open diff.** Run:
```bash
"/c/Program Files/VSCodium/bin/codium" --diff "<file1>" "<file2>"
```
