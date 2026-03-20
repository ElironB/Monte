import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import {
  analyzeTemporalPatterns,
  calculateRecurrence,
  detectTrend,
  scaleConfidence,
} from './temporalUtils.js';

interface WatchEntry {
  title: string;
  date: string;
}

const EDU_PATTERN = /tutorial|lecture|course|documentary|how to|explained/i;
const ENTERTAINMENT_PATTERN = /funny|reaction|gaming|vlog|prank|compilation|meme/i;

const TOPIC_PATTERNS: Record<string, RegExp> = {
  finance: /trading|investing|stock|crypto|wall street|finance|money/i,
  tech: /programming|coding|software|machine learning|ai|data science|api|python/i,
  science: /science|quantum|physics|biology|brain|research/i,
  career: /career|salary|interview|startup|business|negotiate/i,
  history: /history|documentary|rise and fall/i,
};

export class MediaConsumptionExtractor extends SignalExtractor {
  readonly sourceTypes = ['watch_history', 'youtube', 'netflix'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const entries = this.parseEntries(data.rawContent);

    if (entries.length === 0) {
      return this.fallbackExtract(data);
    }

    const signals: BehavioralSignal[] = [];
    const total = entries.length;
    const allTimestamps = entries.map(e => e.date);

    const eduEntries = entries.filter(e => EDU_PATTERN.test(e.title));
    const entEntries = entries.filter(e => ENTERTAINMENT_PATTERN.test(e.title));

    if (eduEntries.length > 0) {
      const ts = eduEntries.map(e => e.date);
      const latestTimestamp = this.getLatestTimestamp(ts);
      const temporal = analyzeTemporalPatterns(ts);
      const trendPoints = this.buildDailyTrend(eduEntries);

      signals.push(
        this.createSignal(
          'interest',
          'educational_content',
          scaleConfidence(eduEntries.length, total, 0.7),
          `${eduEntries.length}/${total} videos are educational (${(eduEntries.length / total * 100).toFixed(0)}%)`,
          data.sourceId,
          {
            category: 'learning',
            frequency: eduEntries.length,
            recurrence: calculateRecurrence(eduEntries.length, total),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
          },
          latestTimestamp,
        ),
      );
    }

    const eduRatio = total > 0 ? eduEntries.length / total : 0;
    const entRatio = total > 0 ? entEntries.length / total : 0;
    if (eduRatio > entRatio * 2 && eduEntries.length >= 2) {
      const latestTimestamp = this.getLatestTimestamp(eduEntries.map(e => e.date));
      signals.push(
        this.createSignal(
          'cognitive_trait',
          'learning_focused',
          Math.min(0.95, 0.55 + eduRatio * 0.4),
          `Education/entertainment ratio: ${eduEntries.length}/${Math.max(1, entEntries.length)} (${(eduRatio * 100).toFixed(0)}% vs ${(entRatio * 100).toFixed(0)}%)`,
          data.sourceId,
          {
            category: 'learning',
            frequency: eduEntries.length,
            recurrence: calculateRecurrence(eduEntries.length, total),
          },
          latestTimestamp,
        ),
      );
    }

    const dailyCounts = new Map<string, number>();
    for (const e of entries) {
      const day = e.date.slice(0, 10) || 'unknown';
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
    }
    const bingeDays = Array.from(dailyCounts.entries()).filter(([, c]) => c >= 3);
    const maxPerDay = dailyCounts.size > 0 ? Math.max(...Array.from(dailyCounts.values())) : 0;

    if (total > 5) {
      const temporal = analyzeTemporalPatterns(allTimestamps);
      const latestTimestamp = this.getLatestTimestamp(allTimestamps);
      const trendPoints = Array.from(dailyCounts.entries())
        .filter(([k]) => k !== 'unknown')
        .map(([ts, v]) => ({ timestamp: ts, value: v }));

      signals.push(
        this.createSignal(
          'interest',
          'high_media_consumption',
          scaleConfidence(total, 20, 0.6),
          `${total} videos across ${dailyCounts.size} days (max ${maxPerDay}/day, ${bingeDays.length} binge days)`,
          data.sourceId,
          {
            category: 'media',
            frequency: total,
            recurrence: calculateRecurrence(bingeDays.length, dailyCounts.size),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
          },
          latestTimestamp,
        ),
      );
    }

    const topicHits: Record<string, number> = {};
    for (const e of entries) {
      for (const [topic, pattern] of Object.entries(TOPIC_PATTERNS)) {
        if (pattern.test(e.title)) {
          topicHits[topic] = (topicHits[topic] || 0) + 1;
        }
      }
    }
    const dominantTopics = Object.entries(topicHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([t]) => t);

    if (dominantTopics.length > 0) {
      const topSignal = signals.find(s => s.value === 'educational_content' || s.value === 'high_media_consumption');
      if (topSignal) {
        topSignal.dimensions.coOccurrence = dominantTopics;
      }
    }

    return signals;
  }

  private parseEntries(raw: string): WatchEntry[] {
    try {
      const parsed = JSON.parse(raw);
      const arr: unknown[] = parsed.history || parsed.videos || (Array.isArray(parsed) ? parsed : []);
      return arr
        .filter((e: any) => e && typeof e.title === 'string')
        .map((e: any) => ({
          title: e.title || '',
          date: e.date || e.timestamp || e.watched_at || '',
        }));
    } catch {
      return [];
    }
  }

  private buildDailyTrend(entries: WatchEntry[]): Array<{ timestamp: string; value: number }> {
    const byDay = new Map<string, number>();
    for (const e of entries) {
      const day = e.date.slice(0, 10) || 'unknown';
      byDay.set(day, (byDay.get(day) || 0) + 1);
    }
    return Array.from(byDay.entries())
      .filter(([k]) => k !== 'unknown')
      .map(([ts, v]) => ({ timestamp: ts, value: v }));
  }

  private fallbackExtract(data: RawSourceData): BehavioralSignal[] {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();

    if (EDU_PATTERN.test(content)) {
      signals.push(this.createSignal('interest', 'educational_content', 0.42, 'High consumption of educational media', data.sourceId, { category: 'learning' }, data.metadata?.timestamp));
    }

    const entertainmentWords = ['funny', 'reaction', 'gaming', 'vlog', 'prank'];
    const eduWords = ['documentary', 'lecture', 'science', 'history', 'tutorial'];
    const entCount = entertainmentWords.reduce((c, w) => c + (content.match(new RegExp(w, 'g')) || []).length, 0);
    const eduCount = eduWords.reduce((c, w) => c + (content.match(new RegExp(w, 'g')) || []).length, 0);

    if (eduCount > entCount * 2) {
      signals.push(this.createSignal('cognitive_trait', 'learning_focused', 0.45, 'Media consumption heavily skewed toward educational content', data.sourceId, { category: 'learning' }, data.metadata?.timestamp));
    }

    const timestamps = data.rawContent.match(/\d{4}-\d{2}-\d{2}/g) || [];
    if (timestamps.length > 10) {
      signals.push(this.createSignal('interest', 'high_media_consumption', 0.36, `High volume of watch history: ${timestamps.length} entries`, data.sourceId, { category: 'media' }, data.metadata?.timestamp));
    }
    return signals;
  }
}
