---
name: onboard
description: "First-run onboarding for a new project. Scans for unfilled {CONFIGURE:} placeholders, asks project-specific questions, fills them in, and logs decisions."
---

# Onboard

Interactive onboarding that customizes the framework for a specific project.

## When to trigger

- User says "onboard", "set up", "initialize", "configure for my project"
- SessionStart hook reports unfilled placeholders
- `python .claude/skills/onboard/scripts/scan-placeholders.py` exits with code 1

## Process

### Step 1: Run the placeholder scan

```bash
python .claude/skills/onboard/scripts/scan-placeholders.py --json
```

Parse the JSON output. This gives you every `{CONFIGURE:}` placeholder
with its file, line number, and tier (core or optional).

### Step 2: Ask questions by category

Present questions one category at a time. Confirm each before moving on.

**Category 1 — Core (AGENTS.md) — cannot skip:**

- What is this initiative? (name + one-line goal)
- What tools and technologies does this use? (languages, frameworks, platforms, services — whatever applies)
- What are the key commands? (build, generate, validate, deploy — whatever applies)

**Category 2 — Agents — cannot skip:**

- What is the brand voice? (tone, banned words, writing style)
  → Fills `content-editor.md`
- What is the technical context and structure?
  → Fills `fullstack-engineer.md`

**Category 3 — Testing (test-strategy) — can skip:**

- What is the routing/page structure?
- What categories should QA check? (i18n, auth, API, SEO, etc.)
- What are the build validation commands?
- Any known gotchas?

If user skips: replace each `{CONFIGURE:}` with `[Not applicable]`.

**Category 4 — Translation (translator) — can skip:**

- Is this project multilingual?
- If no: replace all translator `{CONFIGURE:}` with `[Not applicable]`. Done.
- If yes: what i18n framework? What locales? Where do files live?

### Step 3: Fill in placeholders

For each answer, use the Edit tool to replace `{CONFIGURE: ...}` with
the actual value. The replacement must NOT contain `{CONFIGURE:` — that's
how the scan knows it's been filled.

### Step 4: Fill STATUS.md

Set initiative health to "On Track", last updated to current date
(from `python .claude/scripts/now.py`), and active work to a brief
summary of the initiative.

### Step 5: Verify

```bash
python .claude/skills/onboard/scripts/scan-placeholders.py
```

Expected: "All placeholders filled." Exit code 0.

If placeholders remain, show the user what's left and ask if they want
to fill or skip each one.

### Step 6: Create .onboarded marker

```bash
echo "configured" > .claude/.onboarded
```

This prevents the SessionStart hook from running the scan on future sessions.

### Step 7: Log the onboarding

```bash
python .claude/skills/workflow/scripts/log-entry.py \
  --event "Onboarding complete" \
  --summary "Framework configured for {project name}" \
  --what-changed "Filled {N} placeholders, skipped {M}" \
  --status-update "Onboarding: complete"
```

## What you do NOT do

- Do not create plans or issues (that comes after onboarding)
- Do not modify the workflow skill (project-agnostic)
- Do not modify rules (universal constraints)
- Do not modify scripts (generic utilities)
- Do not guess answers — ask the user
