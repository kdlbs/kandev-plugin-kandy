---
status: building
created: 2026-07-31
---

# Responsive Topbar Control

## Why

Kandy's session-topbar control is smaller than the mobile controls around it. It needs to preserve the compact desktop rhythm while remaining a reliable touch target on phones.

## What

- In the desktop session topbar, Kandy renders as a 28px square control, aligned with native metric chips.
- Below Kandev's 640px phone breakpoint, Kandy renders with a 44px square interactive target.
- Resizing across the breakpoint updates the rendered target without requiring a page reload.
- The control's visual content, tooltip behavior, dialog behavior, and accessible label remain unchanged.

## Scenarios

- **GIVEN** a desktop-width session topbar, **WHEN** Kandy renders, **THEN** its interactive control is 28px tall and wide.
- **GIVEN** a phone-width session topbar, **WHEN** Kandy renders, **THEN** its interactive control is 44px tall and wide.
- **GIVEN** the viewport crosses the phone breakpoint, **WHEN** the topbar remains mounted, **THEN** Kandy adopts the target size for the new viewport.

## Out of scope

- Changing Kandy's portrait art, data loading, or interaction semantics.
- Changing host-owned topbar controls.
