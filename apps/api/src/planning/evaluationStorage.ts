import { sql } from 'drizzle-orm';
import { db } from '../db/client';

export const DEFAULT_EVALUATION_RETENTION_DAYS = 30;
export const DEFAULT_EVALUATION_RETENTION_BATCH_SIZE = 500;

/** Bounded leaf-first collection preserves published evaluations and every referenced ancestor. */
export async function pruneEvaluationStorage(
  options: {
    now?: Date;
    retentionDays?: number;
    batchSize?: number;
  } = {},
) {
  const retentionDays = options.retentionDays ?? DEFAULT_EVALUATION_RETENTION_DAYS;
  const batchSize = options.batchSize ?? DEFAULT_EVALUATION_RETENTION_BATCH_SIZE;
  if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) {
    throw new RangeError('Evaluation retention must be an integer from 7 through 3650 days');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 5000) {
    throw new RangeError('Evaluation retention batch size must be an integer from 1 through 5000');
  }
  const cutoff = new Date((options.now ?? new Date()).getTime() - retentionDays * 86_400_000);
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('runcast.evaluation_retention_cutoff', ${cutoff.toISOString()}, true)`,
    );
    let evaluationsDeleted = 0;
    // Removing leaves first avoids the immutable predecessor's ON DELETE SET NULL action.
    // A whole obsolete occurrence chain can be collected in one pass, up to the row budget.
    while (evaluationsDeleted < batchSize) {
      const deleted = await tx.execute(sql`
        WITH candidates AS (
          SELECT evaluation.id FROM recommendation_evaluations evaluation
          WHERE evaluation.evaluated_at < ${cutoff.toISOString()} AND evaluation.window_end < ${cutoff.toISOString()}
            AND NOT EXISTS (SELECT 1 FROM notification_publications publication WHERE publication.evaluation_id = evaluation.id)
            AND NOT EXISTS (SELECT 1 FROM recommendation_evaluations child WHERE child.predecessor_id = evaluation.id)
          ORDER BY evaluation.evaluated_at, evaluation.id
          LIMIT ${batchSize - evaluationsDeleted}
          FOR UPDATE OF evaluation SKIP LOCKED
        )
        DELETE FROM recommendation_evaluations evaluation USING candidates
        WHERE evaluation.id = candidates.id RETURNING evaluation.id
      `);
      if (!deleted.length) break;
      evaluationsDeleted += deleted.length;
    }
    const candidates = await tx.execute<{ id: string }>(sql`
      SELECT artifact.id FROM planning_bundle_artifacts artifact
      WHERE artifact.created_at < ${cutoff.toISOString()}
        AND NOT EXISTS (SELECT 1 FROM recommendation_evaluations evaluation WHERE evaluation.planning_bundle_id = artifact.id)
      ORDER BY artifact.created_at, artifact.id LIMIT ${batchSize}
      FOR UPDATE OF artifact SKIP LOCKED
    `);
    // A writer can commit a reference after the selection snapshot was taken,
    // but before we lock that artifact. Recheck in a separate statement with a
    // fresh READ COMMITTED snapshot. Our row locks fence subsequent writers.
    const artifacts = candidates.length
      ? await tx.execute(sql`
          DELETE FROM planning_bundle_artifacts artifact
          WHERE artifact.id IN (${sql.join(
            candidates.map(({ id }) => sql`${id}::uuid`),
            sql`, `,
          )})
            AND NOT EXISTS (SELECT 1 FROM recommendation_evaluations evaluation WHERE evaluation.planning_bundle_id = artifact.id)
          RETURNING artifact.id
        `)
      : [];
    return { cutoff: cutoff.toISOString(), evaluationsDeleted, artifactsDeleted: artifacts.length };
  });
}

export interface EvaluationStorageMetrics extends Record<string, unknown> {
  evaluationCount: number;
  publishedEvaluationCount: number;
  inlineSnapshotCount: number;
  artifactReferenceCount: number;
  artifactCount: number;
  inlineSnapshotBytes: number;
  candidateAssessmentBytes: number;
  artifactSnapshotBytes: number;
  referencedSnapshotBytes: number;
  evaluationRelationBytes: number;
  artifactRelationBytes: number;
  oldestEvaluationAt: Date | string | null;
}

/** Read-only measurement against the connected database; relation bytes include TOAST and indexes. */
export async function measureEvaluationStorage() {
  const result = await db.execute<EvaluationStorageMetrics>(sql`
    SELECT
      (SELECT count(*) FROM recommendation_evaluations)::float8 AS "evaluationCount",
      (SELECT count(*) FROM notification_publications)::float8 AS "publishedEvaluationCount",
      (SELECT count(*) FROM recommendation_evaluations WHERE planning_bundle_snapshot IS NOT NULL)::float8 AS "inlineSnapshotCount",
      (SELECT count(*) FROM recommendation_evaluations WHERE planning_bundle_id IS NOT NULL)::float8 AS "artifactReferenceCount",
      (SELECT count(*) FROM planning_bundle_artifacts)::float8 AS "artifactCount",
      (SELECT COALESCE(sum(pg_column_size(planning_bundle_snapshot)), 0) FROM recommendation_evaluations)::float8 AS "inlineSnapshotBytes",
      (SELECT COALESCE(sum(pg_column_size(candidate_assessments)), 0) FROM recommendation_evaluations)::float8 AS "candidateAssessmentBytes",
      (SELECT COALESCE(sum(pg_column_size(snapshot)), 0) FROM planning_bundle_artifacts)::float8 AS "artifactSnapshotBytes",
      (SELECT COALESCE(sum(pg_column_size(artifact.snapshot)), 0) FROM recommendation_evaluations evaluation
        JOIN planning_bundle_artifacts artifact ON artifact.id = evaluation.planning_bundle_id)::float8 AS "referencedSnapshotBytes",
      pg_total_relation_size('recommendation_evaluations')::float8 AS "evaluationRelationBytes",
      pg_total_relation_size('planning_bundle_artifacts')::float8 AS "artifactRelationBytes",
      (SELECT min(evaluated_at) FROM recommendation_evaluations) AS "oldestEvaluationAt"
  `);
  const row = result[0];
  return {
    ...row,
    measuredAt: new Date().toISOString(),
    estimatedSnapshotBytesAvoided: Math.max(
      0,
      Number(row.referencedSnapshotBytes) - Number(row.artifactSnapshotBytes),
    ),
    totalRelationBytes: Number(row.evaluationRelationBytes) + Number(row.artifactRelationBytes),
  };
}
