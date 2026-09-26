import { usePlanner } from '../app/state';
import { SummaryCards } from './cards/SummaryCards';
import { Splits } from './cards/Splits';
import { PaceStepper, RoutePicker, ThemeToggle, UnitToggle } from './controls/Controls';
import { StartTimeScrubber } from './controls/StartTimeScrubber';
import { PlayButton } from './controls/PlayButton';
import { MapView } from './map/MapView';
import { RouteConditionsStrip } from './strip/RouteConditionsStrip';
import { StripLegend } from './strip/StripLegend';

export function App() {
  const planner = usePlanner();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="brand-mark" src="/runcast-mark.svg" alt="" aria-hidden="true" />
          <span className="brand-wordmark">Runcast</span>
        </div>
        <RoutePicker planner={planner} />
        <div className="topbar-right">
          <UnitToggle planner={planner} />
          <ThemeToggle planner={planner} />
        </div>
      </header>

      <main className="main">
        <MapView
          route={planner.activePlanningRoute}
          profile={planner.routeConditionsProfile}
          theme={planner.theme}
          units={planner.units}
          timezone={planner.timezone}
          shadeHighlight={planner.shadeHighlight}
        />
        <aside className="panel">
          {/* The "day" panel: when to start, what it costs, when is best. */}
          <div className="card">
            <StartTimeScrubber planner={planner} />
          </div>
          <SummaryCards planner={planner} />
          {/* Set-once control — deliberately below the live feedback. */}
          <div className="card">
            <PaceStepper planner={planner} />
          </div>
          <Splits planner={planner} />
        </aside>
      </main>

      <div className="strip-zone">
        <PlayButton profile={planner.routeConditionsProfile} />
        <StripLegend profile={planner.routeConditionsProfile} />
        <RouteConditionsStrip
          profile={planner.routeConditionsProfile}
          units={planner.units}
          theme={planner.theme}
          timezone={planner.timezone}
        />
      </div>
    </div>
  );
}
