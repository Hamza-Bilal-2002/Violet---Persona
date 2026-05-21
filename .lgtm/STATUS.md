# Initiative Status — VRM Avatar Lab

**Health**: On Track
**Last updated**: 2026-05-21
**Onboarding**: Complete

## Active work

Interactive VRM avatar playground with animations, lip-sync, and expressions. The project loads `frontend/models/persona.vrm` and drives it with FBX clips from `frontend/animations/` through a layered runtime (`config` → `core` → `loaders` → `managers` → `runtime`).

Immediate focus area (from `next-promt.txt`): reconcile `runtime/RuntimeController.js` against `core/` primitives — `RuntimeController` currently redefines pieces (renderer, controls) that already exist in `core/renderer.js`, `core/controls.js`, etc. Plan should consolidate to imports from `core/`.

## Projects

_No projects opened yet. Create one with the workflow skill when ready: `.lgtm/shared/plans/p1-{slug}/PLAN.md`._

## Unplanned contributions

| Date | Summary | PR / artifact |
|------|---------|---------------|
| —    | —       | —             |
