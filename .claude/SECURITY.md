# Security policy

## Reporting a vulnerability

If you find a security issue in LGTM, please report it privately. Do not open a public issue.

**Email:** security@silverthreadlabs.com

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected files or components
- Potential impact

We will acknowledge receipt within 48 hours and aim to provide a fix or mitigation within 7 days for confirmed issues.

## Scope

LGTM is a framework that orchestrates AI agents. Security concerns fall into a few categories:

### Agent isolation
- Agents should only access files specified in their issue spec
- Agents should never commit secrets, environment files, or credentials
- The `git add -A` prohibition exists specifically to prevent accidental secret exposure

### Git safety
- Protected branches (`master`, `develop`, `{project}-base`) should never receive direct commits
- Force pushes are never used
- All changes flow through PRs for human review

### Credential handling
- LGTM does not store or manage credentials directly
- Authentication state for browser testing (QA agent) is saved to local files that should not be committed
- `.gitignore` should exclude `.claude/worktrees/`, `.claude/settings.local.json`, and any auth state files

### Hook safety
- `.claude/settings.json` contains hooks that run shell commands on session events
- Review hook commands before using a fork or third-party modification of LGTM
- Hooks run with the same permissions as Claude Code itself

## What LGTM does not cover

LGTM orchestrates work. It does not sandbox agent execution. Agents run with whatever permissions Claude Code has on your machine. The framework's safety model is:

1. **Structural** — one branch per issue, PRs only, no `git add -A`
2. **Procedural** — human reviews every PR before merge
3. **Convention-based** — rules files tell agents what not to do

It is not a security sandbox. If you need execution isolation, run agents in containers or restricted environments.

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest on `main` | Yes |
| Older commits | Best effort |
