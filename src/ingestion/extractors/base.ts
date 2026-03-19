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
    dimensions: BehavioralSignal['dimensions'] = {}
  ): BehavioralSignal {
    return {
      id: uuidv4(),
      type,
      value,
      confidence,
      evidence,
      sourceDataId,
      timestamp: new Date().toISOString(),
      dimensions,
    };
  }
}
