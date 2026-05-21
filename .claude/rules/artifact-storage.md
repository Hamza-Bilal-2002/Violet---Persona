# Agent Output Storage

## Purpose

`.lgtm/ai/process-artifacts/` is where agents and skills store everything they produce. Reports, rewrites, enriched data, generated content, intermediate files. If an agent creates it, it goes here.

## Folder structure

```
.lgtm/ai/process-artifacts/
  └── {project}/
        └── {milestone}/
              └── {issue}/
```

Mirrors the initiative hierarchy from CLAUDE.md. The orchestrator creates the path and passes it to the agent at dispatch time. The agent writes whatever it produces into that folder.

## Rules

- Agents write all output files to the path they are given
- Outputs are never deleted. They are the persistent record of what each agent produced.
- The orchestrator is responsible for passing the correct output path when dispatching an agent
- Agents do not decide their own output path
- All timestamps in artifacts must come from `python .claude/scripts/now.py` — never hallucinate dates or times

## What goes here

The rule does not prescribe what agents produce. Different processes produce different things:

- A humanizer produces a report and a rewritten file
- A sitemap enricher produces enriched JSON entries per page
- A QA agent produces a pass/fail report
- A content writer produces MDX files or dictionary entries
- A translation agent produces translated files

Whatever the agent produces, it goes in the issue folder. Downstream agents or the user can read from it later.

## Why

1. **Persistence.** Agent outputs survive context compaction and session boundaries. A content writer next week can read enriched entries produced today.
2. **Review.** The user can inspect what an agent proposed before approving it, or review it later.
3. **Traceability.** Every agent's output is tied to a specific project, milestone, and issue.
4. **Handoff.** Downstream agents can consume upstream agent outputs by reading from the same hierarchy.
