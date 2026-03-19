import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';

export class CognitiveStructureExtractor extends SignalExtractor {
  readonly sourceTypes = ['notes', 'obsidian', 'notion'];
  
  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent;
    
    // Organization level (from note structure)
    const hasStructure = /#+\s|```|table|list/i.test(content);
    const wordCount = content.split(/\s+/).length;
    
    if (hasStructure && wordCount > 1000) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'highly_organized',
        0.75,
        'Structured notes with clear hierarchy',
        data.sourceId,
        { category: 'cognition' }
      ));
    } else if (!hasStructure && wordCount > 500) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'freeform_thinker',
        0.65,
        'Unstructured, stream-of-consciousness notes',
        data.sourceId,
        { category: 'cognition' }
      ));
    }
    
    // Goal-setting behavior
    if (/goal|objective|target|plan.*202|q1|q2|q3|q4/i.test(content.toLowerCase())) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'goal_oriented',
        0.7,
        'Explicit goal-setting language detected',
        data.sourceId,
        { category: 'cognition' }
      ));
    }
    
    // Self-reflection depth
    const reflectionWords = ['feel', 'think', 'realized', 'learned', 'why', 'because'];
    const reflectionCount = reflectionWords.reduce((count, word) => 
      count + (content.toLowerCase().match(new RegExp(word, 'g')) || []).length, 0
    );
    
    if (reflectionCount > 10) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'deep_self_reflection',
        0.8,
        'High frequency of introspective language',
        data.sourceId,
        { category: 'cognition' }
      ));
    }
    
    return signals;
  }
}
