import { runWriteSingle } from '../config/neo4j.js';
import type { CloneResult } from './types.js';

export interface CloneResultBatchRow {
  resultId: string;
  cloneId: string;
  percentile: number;
  category: 'edge' | 'central' | 'typical';
  path: string;
  finalState: string;
  metrics: string;
  duration: number;
}

export function createCloneResultBatchRows(results: CloneResult[]): CloneResultBatchRow[] {
  return results.map((result) => ({
    resultId: result.cloneId,
    cloneId: result.cloneId,
    percentile: result.stratification.percentile,
    category: result.stratification.category,
    path: JSON.stringify(result.path),
    finalState: JSON.stringify(result.finalState),
    metrics: JSON.stringify(result.metrics),
    duration: result.duration,
  }));
}

export async function persistCloneResultsBatch(
  simulationId: string,
  results: CloneResult[],
): Promise<void> {
  if (results.length === 0) {
    return;
  }

  await runWriteSingle(
    `MATCH (s:Simulation {id: $simulationId})
     UNWIND $rows AS row
     CREATE (cr:CloneResult {
       id: row.resultId,
       cloneId: row.cloneId,
       percentile: row.percentile,
       category: row.category,
       path: row.path,
       finalState: row.finalState,
       metrics: row.metrics,
       duration: row.duration,
       createdAt: datetime()
     })
     CREATE (s)-[:HAS_RESULT]->(cr)
     RETURN count(cr) as storedCount`,
    {
      simulationId,
      rows: createCloneResultBatchRows(results),
    },
  );
}
