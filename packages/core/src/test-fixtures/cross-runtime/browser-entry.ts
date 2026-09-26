import { evaluateRunV3 } from '../../engine/planning/pipeline';
import { recommendStartV3 } from '../../engine/planning/recommendation';
import { normalizeOpenMeteoForecast } from '../../engine/planning/weather';
import { runCrossRuntimeScenario, type CrossRuntimeScenario } from './scenario';

/** Browser entry uses only platform-neutral leaf ESM modules, as Vite does. */
export const runBrowserGolden = (scenario?: CrossRuntimeScenario) =>
  runCrossRuntimeScenario(
    { normalize: normalizeOpenMeteoForecast, evaluate: evaluateRunV3, recommend: recommendStartV3 },
    scenario,
  );
