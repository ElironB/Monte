import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import {
  analyzeTemporalPatterns,
  calculateRecurrence,
  detectTrend,
  scaleConfidence,
} from './temporalUtils.js';

interface SearchEntry {
  query: string;
  timestamp: string;
}

const CATEGORIES: Record<string, { value: string; category: string; base: number; pattern: RegExp }> = {
  finance: {
    value: 'financial_trading',
    category: 'finance',
    base: 0.8,
    pattern: /stock|crypto|invest|trading|bitcoin|ethereum|trade/i,
  },
  career: {
    value: 'career_change',
    category: 'career',
    base: 0.7,
    pattern: /career change|new job|salary|interview|resume|linkedin/i,
  },
  education: {
    value: 'education',
    category: 'education',
    base: 0.75,
    pattern: /degree|master|mba|phd|university|college|course|certification/i,
  },
  relocation: {
    value: 'relocation',
    category: 'lifestyle',
    base: 0.6,
    pattern: /moving to|relocate|apartment|house|rent|city/i,
  },
  health: {
    value: 'health_fitness',
    category: 'health',
    base: 0.65,
    pattern: /gym|workout|diet|lose weight|fitness|healthy/i,
  },
};

export class SearchHistoryExtractor extends SignalExtractor {
  readonly sourceTypes = ['search_history'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const entries = this.parseEntries(data.rawContent);

    if (entries.length === 0) {
      return this.fallbackExtract(data);
    }

    const signals: BehavioralSignal[] = [];
    const totalEntries = entries.length;

    for (const cat of Object.values(CATEGORIES)) {
      const matched = entries.filter(e => cat.pattern.test(e.query));
      if (matched.length === 0) continue;

      const matchedTimestamps = matched.map(e => e.timestamp);
      const temporal = analyzeTemporalPatterns(matchedTimestamps);
      const recurrence = calculateRecurrence(matched.length, totalEntries);

      const trendPoints = this.buildTrendPoints(matched, cat.pattern);
      const trend = detectTrend(trendPoints);

      const urgency = this.extractUrgency(matched.map(e => e.query).join(' '));
      const confidence = scaleConfidence(matched.length, totalEntries, cat.base);

      signals.push(
        this.createSignal(
          'interest',
          cat.value,
          confidence,
          `${matched.length}/${totalEntries} searches match (${(recurrence * 100).toFixed(0)}%): ${matched.map(e => e.query).slice(0, 3).join('; ')}`,
          data.sourceId,
          {
            category: cat.category,
            urgency,
            frequency: matched.length,
            recurrence,
            temporalCluster: temporal.dominantCluster,
            intensityTrend: trend,
          },
        ),
      );
    }

    return signals;
  }

  private parseEntries(raw: string): SearchEntry[] {
    try {
      const parsed = JSON.parse(raw);
      const arr: unknown[] = parsed.searches || parsed.history || (Array.isArray(parsed) ? parsed : []);
      return arr
        .filter((e: any) => e && typeof e.query === 'string')
        .map((e: any) => ({ query: (e.query as string).toLowerCase(), timestamp: e.timestamp || '' }));
    } catch {
      return [];
    }
  }

  private buildTrendPoints(
    entries: SearchEntry[],
    pattern: RegExp,
  ): Array<{ timestamp: string; value: number }> {
    const byDay = new Map<string, number>();
    for (const e of entries) {
      const day = e.timestamp.slice(0, 10) || 'unknown';
      const matches = (e.query.match(new RegExp(pattern.source, 'gi')) || []).length;
      byDay.set(day, (byDay.get(day) || 0) + matches);
    }
    return Array.from(byDay.entries())
      .filter(([k]) => k !== 'unknown')
      .map(([ts, v]) => ({ timestamp: ts, value: v }));
  }

  private extractUrgency(content: string): number {
    const urgentWords = ['urgent', 'now', 'immediately', 'asap', 'today', 'quick'];
    return Math.min(1, urgentWords.reduce((score, word) => content.includes(word) ? score + 0.2 : score, 0));
  }

  private fallbackExtract(data: RawSourceData): BehavioralSignal[] {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();

    for (const cat of Object.values(CATEGORIES)) {
      if (cat.pattern.test(content)) {
        signals.push(
          this.createSignal(
            'interest',
            cat.value,
            cat.base * 0.6,
            `Search queries (unparsed): ${data.rawContent.substring(0, 200)}`,
            data.sourceId,
            {
              category: cat.category,
              urgency: cat.category === 'finance' || cat.category === 'career' ? this.extractUrgency(content) : undefined,
            },
          ),
        );
      }
    }
    return signals;
  }
}
