import { closeDatabase } from './db/client';
import { measureEvaluationStorage } from './planning/evaluationStorage';

try {
  console.log(JSON.stringify(await measureEvaluationStorage(), null, 2));
} finally {
  await closeDatabase();
}
