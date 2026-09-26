import { evaluateRunV3, normalizeOpenMeteoForecast, recommendStartV3 } from '../../index';
import { runCrossRuntimeScenario, type CrossRuntimeScenario } from './scenario';

/** Metro/Hermes consumes the TypeScript package entry and no Node or DOM globals. */
export const runHermesCompatibleGolden = (scenario?: CrossRuntimeScenario) =>
  runCrossRuntimeScenario(
    { normalize: normalizeOpenMeteoForecast, evaluate: evaluateRunV3, recommend: recommendStartV3 },
    scenario,
  );
