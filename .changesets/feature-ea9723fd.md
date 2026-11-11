---
bump: minor
type: feature
scope: check
---
Retry unknown dates once when they are 10% or less of the dates, so one slow page doesn't break a stretch. When more than 10% are unknown, skip the retry to avoid adding load to a site that may be blocking the scraper, send a Slack message with the number of unknown dates, the total and a link to the workflow run, and fail the workflow run. In that case, still alert on stretches found among the other dates, and keep the previously alerted stretches in state, so they don't alert again once those dates have answers again.