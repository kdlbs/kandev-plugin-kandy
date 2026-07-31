---
spec: docs/specs/responsive-topbar-control/spec.md
created: 2026-07-31
status: completed
---

# Implementation Plan: Responsive Kandy Topbar Control

## Overview

Add a plugin-owned responsive rule for the Kandy session-topbar button. Keep
the existing 28px desktop geometry, provide a 44px phone hit target below the
640px breakpoint, and prove the emitted UI stylesheet contains both viewport
modes without changing Kandy behavior.

## UI

- Update `ui/bundle.js`'s injected Kandy stylesheet for `#kandev-kandy-widget`.
- Preserve the existing button presentation and behavior; only its control
  geometry changes by viewport.

## Tests

- Extend `ui/bundle.test.js` to initialize the plugin with the existing test
  document and assert the injected stylesheet contains the desktop and phone
  dimensions and the 640px media boundary.
- Run `node --test ui/bundle.test.js` and `make test`.

## Task

- [x] [task-01-responsive-control](task-01-responsive-control.md) — completed
