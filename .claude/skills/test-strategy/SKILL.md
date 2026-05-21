---
name: test-strategy
description: |
  Project-specific test strategy. Defines what to verify beyond generic
  dogfooding: domain-specific checks, content rendering, build validation,
  and error boundaries. Use alongside the dogfood skill which provides
  the methodology.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Test Strategy

What to check on this project, on top of dogfood's generic exploratory testing.
This skill defines the WHAT. The dogfood skill defines the HOW.

## Stack context

[Not applicable]

## Checklist

### 1. [Not applicable]

- [Not applicable]
- [Not applicable]

### 2. [Not applicable]

- [Not applicable]

### 3. Network health

At each page, inspect network requests:

```bash
agent-browser network requests --status 4xx --session {SESSION}
agent-browser network requests --status 5xx --session {SESSION}
```

Flag:
- **Failed requests** — any 4xx/5xx responses (broken assets, failed API calls)
- **Mixed content** — HTTP resources loaded on HTTPS page
- **Unexpected third-party calls** — domains that shouldn't be there
- **Slow resources** — anything visibly blocking page render

### 4. Content rendering

- Index pages show item lists, not empty
- Detail pages render body content with headings
- Homepage hero, CTAs, and all sections load

### 5. Error boundary

- `/nonexistent-page` renders custom 404 with working nav back to home
- No white screen or crash

### 6. Responsive

Test at desktop (1280x720) and mobile (375x812):
- No horizontal overflow
- Text readable, not clipped
- Mobile navigation opens and contains correct links
- CTAs tappable on mobile

### 7. Build validation

Run before or after browser testing to catch non-visual issues:

1. **Type checks**: [Not applicable]
2. **Linting**: [Not applicable]
3. **Tests**: [Not applicable]
4. **Production build**: [Not applicable]

Report pass/fail for each. If any check fails, diagnose but do NOT auto-fix.

## Gotchas

[Not applicable]
