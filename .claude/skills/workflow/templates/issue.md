# {issue-id}: {short title}

| Field | Value |
|-------|-------|
| Project | {project name} |
| Milestone | {milestone name} |
| Assignee | agent / human |
| Status | draft / ready / in-progress / in-review / done / blocked |
| Branch | {project}-{descriptive-slug} |
| PR target | {project}-base |
| Depends on | {issue-ids or "none"} |
| Created | {timestamp from `python .claude/scripts/now.py`} |

## Objective

{1-2 sentences: what this issue accomplishes and why.}

## Files to Modify

> Agent issues only. Remove this section for human issues.

- `{path}` — {what changes and why}

## Implementation

> Agent issues: specific changes, patterns, steps.
> Human issues: numbered steps with verification.

{Enough detail that an agent with zero context can execute,
or a human can follow without ambiguity.}

## Test Cases

- [ ] Given {precondition}, when {action}, then {expected result}

## Acceptance Criteria

- [ ] Verification checks pass
- [ ] {specific verification steps}

## Open Questions

{Ambiguity, risk, or decisions that must be resolved before execution.
Empty this section before changing status to `ready`.}
