# Weekly running schedule

Settings → Running schedule opens seven 24-hour bars. Each hour toggles independently. The text above each bar lists every contiguous interval; deselecting an hour splits an interval. Empty days show “Day off,” and selecting all 24 hours shows “All day.” The selected day has two compact actions: Copy opens weekday/weekend/whole-week choices, and Clear removes its hours. On an empty day, Clear becomes Select all.

The schedule repeats in the route’s timezone and limits recommended start times. It does not constrain the run’s finish or prevent manually choosing another departure. Recommendations advance past days off only within the available forecast. Weekly intervals exclude their ending instant so an unselected hour is never recommended at its boundary. Legacy daily preferences retain their existing semantics until edited.

Availability is saved locally, included in offline preference replay, and synchronized through the versioned preferences API. Missing weekly preferences retain the old daily window. Old clients that omit the new field preserve an existing weekly schedule. Migration `0010_weekly_start_schedule.sql` adds the nullable JSON column; deploy the migration/API before a mobile release that sends weekly preferences. No production migration or deployment was performed here.

Weather assessments are cached by their route, forecast, pace, and environmental inputs; editing availability reuses them and changes recommendation ranking.

Validation: full repository tests, repository typechecking and web build, naming checks, and 31 database integration tests against an isolated disposable PostgreSQL database. Unit coverage includes hour merging/splitting, all 24 hours, disjoint intervals, days off, midnight boundaries, route-local weekdays and DST, offline replay, and next-available-day recommendations.

Native iPhone 17e Simulator checks passed for selecting individual hours, merging and splitting intervals, selecting 11 PM–midnight, copying to weekdays, and retaining the schedule after a cold app restart. Review used the live-weather development server; the screen remains open for review.
