---
id: "01-responsive-control"
title: "Responsive Kandy topbar control"
status: done
wave: 1
depends_on: []
plan: "plan.md"
spec: "../../specs/responsive-topbar-control/spec.md"
---

# Task 01: Responsive Kandy topbar control

## Acceptance

- The Kandy topbar button is 28px square on desktop and 44px square below
  640px.
- The responsive rule is emitted by the plugin bundle and does not alter
  tooltip, dialog, or data behavior.

## Verification

- `node --test ui/bundle.test.js`
- `make test`

## Files likely touched

- `ui/bundle.js`
- `ui/bundle.test.js`

## Dependencies and risks

None. The stylesheet is injected by the plugin and must override the host's
utility classes without changing other Kandy surfaces.

## Output contract

Record the changed files, test output, commit, pushed branch, and PR URL in the
primary task conversation.
