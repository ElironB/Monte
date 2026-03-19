import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';

export class FinancialBehaviorExtractor extends SignalExtractor {
  readonly sourceTypes = ['financial', 'plaid', 'banking'];
  
  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();
    
    // Spending pattern detection (from transaction descriptions)
    const impulseWords = ['amazon', 'impulse', 'late night', '2am'];
    const hasImpulseSpending = impulseWords.some(w => content.includes(w));
    
    if (hasImpulseSpending) {
      signals.push(this.createSignal(
        'financial_behavior',
        'impulse_spending',
        0.7,
        'Transaction patterns suggest impulse purchases',
        data.sourceId,
        { category: 'finance' }
      ));
    }
    
    // Budget adherence
    if (/overdraft|declined|insufficient|late fee/i.test(content)) {
      signals.push(this.createSignal(
        'financial_behavior',
        'budget_struggles',
        0.8,
        'Financial stress indicators in transactions',
        data.sourceId,
        { category: 'finance', sentiment: 'negative' }
      ));
    }
    
    // Investment activity
    if (/dividend|deposit.*investment|brokerage/i.test(content)) {
      signals.push(this.createSignal(
        'financial_behavior',
        'active_investor',
        0.75,
        'Regular investment activity detected',
        data.sourceId,
        { category: 'finance' }
      ));
    }
    
    return signals;
  }
}


