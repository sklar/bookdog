---
bump: patch
type: fix
scope: check
---
Use the property name from the URL, without its language code, as the title of every Slack message when the watchdog has no name, including error notifications. Set the Slack send timeout to 10 seconds instead of 5 minutes.