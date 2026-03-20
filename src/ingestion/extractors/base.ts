import { RawSourceData, BehavioralSignal } from '../types.js';
import { v4 as uuidv4 } from 'uuid';

export abstract class SignalExtractor {
  abstract readonly sourceTypes: string[];
  
  abstract extract(data: RawSourceData): Promise<BehavioralSignal[]>;
  
  protected createSignal(
    type: BehavioralSignal['type'],
    value: string,
    confidence: number,
    evidence: string,
    sourceDataId: string,
    dimensions: BehavioralSignal['dimensions'] = {},
    timestamp?: string
  ): BehavioralSignal {
    return {
      id: uuidv4(),
      type,
      value,
      confidence,
      evidence,
      sourceDataId,
      timestamp: timestamp || new Date().toISOString(),
      dimensions,
    };
  }

  protected getLatestTimestamp(timestamps: Array<string | undefined | null>): string | undefined {
    let latestTimestamp: string | undefined;
    let latestTime = Number.NEGATIVE_INFINITY;

    for (const timestamp of timestamps) {
      if (!timestamp) continue;

      const parsedTime = new Date(timestamp).getTime();
      if (Number.isNaN(parsedTime)) continue;

      if (parsedTime > latestTime) {
        latestTime = parsedTime;
        latestTimestamp = timestamp;
      }
    }

    return latestTimestamp;
  }
}
