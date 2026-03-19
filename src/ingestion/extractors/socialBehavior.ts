import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';

export class SocialBehaviorExtractor extends SignalExtractor {
  readonly sourceTypes = ['social_media', 'reddit', 'twitter'];
  
  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();
    
    // Risk tolerance indicators
    if (/yolo|all in|moon|diamond hands|ape/i.test(content)) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'high_risk_tolerance',
        0.75,
        'Social media language indicates risk-seeking behavior',
        data.sourceId,
        { category: 'psychology' }
      ));
    }
    
    // Anxiety/stress indicators
    if (/stressed|anxious|worried|can't sleep|panic/i.test(content)) {
      signals.push(this.createSignal(
        'emotional_state',
        'anxiety',
        0.7,
        'Expressions of stress or anxiety detected',
        data.sourceId,
        { category: 'psychology', sentiment: 'negative' }
      ));
    }
    
    // Decision paralysis
    if (/can't decide|stuck|don't know what to|help me choose/i.test(content)) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'decision_paralysis',
        0.65,
        'Indecision patterns in posts',
        data.sourceId,
        { category: 'psychology' }
      ));
    }
    
    // Social engagement level
    const postCount = (data.metadata as { postCount?: number }).postCount || 1;
    if (postCount > 50) {
      signals.push(this.createSignal(
        'social_pattern',
        'high_social_engagement',
        0.6,
        `High volume of social activity: ${postCount} posts`,
        data.sourceId,
        { category: 'social' }
      ));
    }
    
    return signals;
  }
}
