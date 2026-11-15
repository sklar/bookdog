---
bump: patch
type: fix
scope: CI
---
Re-enable the workflows on every Check Availability run, so GitHub's 60-day inactivity rule doesn't stop the watchdogs without a word. That includes a workflow GitHub has already disabled for inactivity. A workflow you disable by hand stays disabled.
