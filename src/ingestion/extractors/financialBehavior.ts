import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import {
  analyzeTemporalPatterns,
  calculateRecurrence,
  detectTrend,
  scaleConfidence,
} from './temporalUtils.js';

interface Transaction {
  date: string;
  description: string;
  amount: number;
  category: string;
}

const IMPULSE_PATTERN = /amazon|impulse|late night|2am|3am|midnight/i;
const FEE_PATTERN = /overdraft|declined|insufficient|late fee/i;
const INVEST_PATTERN = /dividend|investment|brokerage|deposit.*invest/i;

export class FinancialBehaviorExtractor extends SignalExtractor {
  readonly sourceTypes = ['financial', 'plaid', 'banking'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const transactions = this.parseTransactions(data.rawContent);

    if (transactions.length === 0) {
      return this.fallbackExtract(data);
    }

    const signals: BehavioralSignal[] = [];
    const total = transactions.length;
    const totalSpend = transactions.reduce((s, t) => s + Math.abs(t.amount), 0);

    const impulseTxns = transactions.filter(t => IMPULSE_PATTERN.test(t.description));
    if (impulseTxns.length > 0) {
      const impulseSpend = impulseTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
      const ts = impulseTxns.map(t => t.date);
      const temporal = analyzeTemporalPatterns(ts);
      const trendPoints = impulseTxns.map(t => ({ timestamp: t.date, value: Math.abs(t.amount) }));

      signals.push(
        this.createSignal(
          'financial_behavior',
          'impulse_spending',
          scaleConfidence(impulseTxns.length, total, 0.7),
          `${impulseTxns.length}/${total} transactions are impulse purchases ($${impulseSpend.toFixed(2)} of $${totalSpend.toFixed(2)})`,
          data.sourceId,
          {
            category: 'finance',
            frequency: impulseTxns.length,
            recurrence: calculateRecurrence(impulseTxns.length, total),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
          },
        ),
      );
    }

    const feeTxns = transactions.filter(t => FEE_PATTERN.test(t.description));
    if (feeTxns.length > 0) {
      const feeTotal = feeTxns.reduce((s, t) => s + Math.abs(t.amount), 0);
      const ts = feeTxns.map(t => t.date);
      const temporal = analyzeTemporalPatterns(ts);
      const trendPoints = feeTxns.map(t => ({ timestamp: t.date, value: 1 }));

      signals.push(
        this.createSignal(
          'financial_behavior',
          'budget_struggles',
          scaleConfidence(feeTxns.length, total, 0.8),
          `${feeTxns.length}/${total} transactions are fees/overdrafts ($${feeTotal.toFixed(2)})`,
          data.sourceId,
          {
            category: 'finance',
            sentiment: 'negative',
            frequency: feeTxns.length,
            recurrence: calculateRecurrence(feeTxns.length, total),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
          },
        ),
      );
    }

    const investTxns = transactions.filter(t => INVEST_PATTERN.test(t.description) || t.category === 'investment');
    if (investTxns.length > 0) {
      const ts = investTxns.map(t => t.date);
      const temporal = analyzeTemporalPatterns(ts);

      const months = new Set(investTxns.map(t => t.date.slice(0, 7)));
      const regularity = months.size >= 2 ? 'regular' : 'sporadic';

      const trendPoints = investTxns.map(t => ({ timestamp: t.date, value: Math.abs(t.amount) }));

      signals.push(
        this.createSignal(
          'financial_behavior',
          'active_investor',
          scaleConfidence(investTxns.length, total, 0.75),
          `${investTxns.length}/${total} transactions are investment-related (${regularity} pattern across ${months.size} months)`,
          data.sourceId,
          {
            category: 'finance',
            frequency: investTxns.length,
            recurrence: calculateRecurrence(investTxns.length, total),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
          },
        ),
      );
    }

    return signals;
  }

  private parseTransactions(raw: string): Transaction[] {
    const lines = raw.trim().split('\n');
    if (lines.length < 2) return [];

    const header = lines[0].toLowerCase();
    if (!header.includes('date') && !header.includes('amount')) return [];

    const cols = lines[0].split(',').map(c => c.trim().toLowerCase());
    const dateIdx = cols.indexOf('date');
    const descIdx = cols.indexOf('description');
    const amtIdx = cols.indexOf('amount');
    const catIdx = cols.indexOf('category');

    if (dateIdx === -1 || amtIdx === -1) return [];

    const txns: Transaction[] = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(',').map(c => c.trim());
      if (parts.length < cols.length) continue;
      const amount = parseFloat(parts[amtIdx]);
      if (isNaN(amount)) continue;
      txns.push({
        date: parts[dateIdx] || '',
        description: (parts[descIdx] || '').toLowerCase(),
        amount,
        category: (parts[catIdx] || '').toLowerCase(),
      });
    }
    return txns;
  }

  private fallbackExtract(data: RawSourceData): BehavioralSignal[] {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();

    if (IMPULSE_PATTERN.test(content)) {
      signals.push(this.createSignal('financial_behavior', 'impulse_spending', 0.42, 'Transaction patterns suggest impulse purchases', data.sourceId, { category: 'finance' }));
    }
    if (FEE_PATTERN.test(content)) {
      signals.push(this.createSignal('financial_behavior', 'budget_struggles', 0.48, 'Financial stress indicators in transactions', data.sourceId, { category: 'finance', sentiment: 'negative' }));
    }
    if (INVEST_PATTERN.test(content)) {
      signals.push(this.createSignal('financial_behavior', 'active_investor', 0.45, 'Regular investment activity detected', data.sourceId, { category: 'finance' }));
    }
    return signals;
  }
}
