import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';

export class MediaConsumptionExtractor extends SignalExtractor {
  readonly sourceTypes = ['watch_history', 'youtube', 'netflix'];
  
  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();
    
    // Educational content bias
    if (/tutorial|lecture|course|documentary|how to|explained/i.test(content)) {
      signals.push(this.createSignal(
        'interest',
        'educational_content',
        0.7,
        'High consumption of educational media',
        data.sourceId,
        { category: 'learning' }
      ));
    }
    
    // Entertainment vs education ratio (simplified)
    const entertainmentWords = ['funny', 'reaction', 'gaming', 'vlog', 'prank'];
    const eduWords = ['documentary', 'lecture', 'science', 'history', 'tutorial'];
    
    const entCount = entertainmentWords.reduce((c, w) => 
      c + (content.match(new RegExp(w, 'g')) || []).length, 0
    );
    const eduCount = eduWords.reduce((c, w) => 
      c + (content.match(new RegExp(w, 'g')) || []).length, 0
    );
    
    if (eduCount > entCount * 2) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'learning_focused',
        0.75,
        'Media consumption heavily skewed toward educational content',
        data.sourceId,
        { category: 'learning' }
      ));
    }
    
    // Binge consumption pattern
    const timestamps = data.rawContent.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (timestamps.length > 10) {
      signals.push(this.createSignal(
        'interest',
        'high_media_consumption',
        0.6,
        `High volume of watch history: ${timestamps.length} entries`,
        data.sourceId,
        { category: 'media' }
      ));
    }
    
    return signals;
  }
}
