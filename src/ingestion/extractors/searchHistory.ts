import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';

export class SearchHistoryExtractor extends SignalExtractor {
  readonly sourceTypes = ['search_history'];
  
  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();
    
    // Financial intent detection
    if (/stock|crypto|invest|trading|bitcoin|ethereum|trade/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'financial_trading',
        0.8,
        `Search queries: ${data.rawContent.substring(0, 200)}`,
        data.sourceId,
        { category: 'finance', urgency: this.extractUrgency(content) }
      ));
    }
    
    // Career intent
    if (/career change|new job|salary|interview|resume|linkedin/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'career_change',
        0.7,
        data.rawContent.substring(0, 200),
        data.sourceId,
        { category: 'career', urgency: this.extractUrgency(content) }
      ));
    }
    
    // Education intent
    if (/degree|master|mba|phd|university|college|course|certification/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'education',
        0.75,
        data.rawContent.substring(0, 200),
        data.sourceId,
        { category: 'education' }
      ));
    }
    
    // Relocation intent
    if (/moving to|relocate|apartment|house|rent|city/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'relocation',
        0.6,
        data.rawContent.substring(0, 200),
        data.sourceId,
        { category: 'lifestyle' }
      ));
    }
    
    // Health/fitness
    if (/gym|workout|diet|lose weight|fitness|healthy/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'health_fitness',
        0.65,
        data.rawContent.substring(0, 200),
        data.sourceId,
        { category: 'health' }
      ));
    }
    
    return signals;
  }
  
  private extractUrgency(content: string): number {
    const urgentWords = ['urgent', 'now', 'immediately', 'asap', 'today', 'quick'];
    return urgentWords.reduce((score, word) => 
      content.includes(word) ? score + 0.2 : score, 0
    );
  }
}
