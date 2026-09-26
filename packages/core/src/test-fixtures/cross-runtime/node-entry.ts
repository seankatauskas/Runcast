import { evaluateRunV3, normalizeOpenMeteoForecast, recommendStartV3 } from '../../index';
import { runCrossRuntimeScenario, type CrossRuntimeScenario } from './scenario';

/** Node consumes the public package entry. */
export const runNodeGolden = (scenario?: CrossRuntimeScenario) =>
  runCrossRuntimeScenario(
    { normalize: normalizeOpenMeteoForecast, evaluate: evaluateRunV3, recommend: recommendStartV3 },
    scenario,
  );
