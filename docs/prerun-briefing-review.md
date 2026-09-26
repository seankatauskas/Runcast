# Pre-run briefing review

Runcast helps runners understand a planned route and compare departure times. This iteration keeps the map, bottom card, and detailed Planner, with one displayed run shared across timing, forecast samples, warnings, and narrative.

## Implementation

The first view follows the recommendation inside the acceptable start window. Choosing a time commits it across Explorer, the time picker, Planner, and return navigation. Done in the time picker returns to Explorer; only the Explorer card’s View run plan button opens Planner. Chart previews temporarily show another run; cancellation restores the committed choice. Changing routes resets to its recommendation unless a deep link supplies a time.

Briefings use existing route samples and wind classifications. Comparisons use the recommendation for the selected route-local day. Explorer confirms the best time below the finish time, or shows a concise difference for a selected alternative with meaningful changes. Selecting the recommended instant keeps the Best time heading and recommendation marker. The Explorer card has a fixed, viewport-bounded height and reserves one compact comparison line, so text appearing or disappearing does not move its edges. Longer content scrolls inside the card. The run plan retains the full comparison reference and details; forecast warnings remain visible. Temperature changes below 1°C, rain probability changes below 10 percentage points, and sun/wind changes within existing presentation bands are treated as broadly similar. These are display thresholds, not changes to recommendation or safety policy. Solar exposure remains an estimate.

The briefing itself requires no API, database, forecast provider, native dependency, or engine-version changes. The later [weekly schedule](weekly-running-schedule.md) adds saved preferences and a database migration. Start-time interactions reuse cached weather. The legacy rollback keeps its existing forecast metrics; comparisons require an authoritative evaluated run.

## Five-runner usability script

Recruit five runners, including at least two who already use Runna or another training plan. Let each use a demo first, then their own route if available. Do not explain the screens before the tasks.

1. Open a route. Ask: “When would you leave, when would you finish, and what conditions stand out?” Record whether they can answer all three within 30 seconds without help.
2. Ask them to choose a different departure that fits their schedule. Ask what improved or worsened, and which time the comparison refers to.
3. Open the run plan and return. Ask whether the selected time and conditions remained understandable and consistent.
4. Ask: “Did you learn something that could change this run? Would you check this before your next run? Why?”
5. Invite them to use the app before three subsequent runs; record voluntary return use and actual changes to start time or preparation.

Record task completion, assistance required, misunderstandings, observed decisions, and quotes. Treat stated interest separately from return use. Do not infer market demand from five sessions. Prioritize confusing explanations or controls before expanding feature scope.

## Verification record

Automated checks on September 19, 2026:

- Full repository test suite passed: core 305, contracts 15, API 71, mobile 211, web 5, and release tooling 34; brand validation checked 40 artifacts. The API suite skipped 30 database integration tests.
- After the final mobile fixes, all 212 mobile tests passed, including a device-timezone fallback regression test.
- Repository typechecking, web production build, formatting, and naming checks passed.
- The new Maestro journey passed, including with Simulator Reduce Motion enabled. It verifies recommended briefing visibility, a different start tomorrow, and identical finish summaries after navigating to Planner, back to Explorer, and reopening Planner.
- All five Maestro flows passed individually: introduction/demo/replay, route-library lifecycle, forecast retry, pre-run briefing, and valid/missing route deep links. The largest Dynamic Type check confirmed the primary action remains visible and the Planner briefing is reachable by scrolling.

Native review uses an iPhone 17e Simulator on iOS 26.5, the isolated Runcast E2E Debug binary, and Metro serving this worktree. Local copies of the checked-in Maestro flows add development-client launch steps and retain the same E2E fixtures and assertions. For the final onboarding/menu checks, developer-menu preferences were disabled in the Simulator-installed Debug app to prevent its floating tools button from intercepting app-menu taps. A release binary was not rebuilt for this review.

Physical-device VoiceOver, push delivery, and real-run forecast accuracy remain device/beta checks. The five-runner script above is ready to conduct; no participant sessions have been performed.

## Visual review

Screenshots capture the selected noon run on Central Park Loop. Explorer keeps the map and departure controls together; Planner carries the same briefing and finish time.

| Mode                 | Explorer                                              | Planner                                              |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| Light                | [Screenshot](prerun-briefing/explorer-light.png)      | [Screenshot](prerun-briefing/planner-light.png)      |
| Dark                 | [Screenshot](prerun-briefing/explorer-dark.png)       | [Screenshot](prerun-briefing/planner-dark.png)       |
| Largest Dynamic Type | [Screenshot](prerun-briefing/explorer-large-text.png) | [Screenshot](prerun-briefing/planner-large-text.png) |

At the largest text setting, the dock body scrolls while departure, pace, and the primary action remain reachable. The map toolbar route label caps scaling at 1.5 within its fixed-height button; its accessibility label retains the full route name. Screenshots include the development client's floating tools button, which is absent from release builds.
