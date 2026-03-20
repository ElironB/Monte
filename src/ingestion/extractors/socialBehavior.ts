import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import {
  analyzeTemporalPatterns,
  calculateRecurrence,
  detectTrend,
  scaleConfidence,
} from './temporalUtils.js';

interface Post {
  body: string;
  title: string;
  timestamp: string;
}

const RISK_PATTERN = /yolo|all in|moon|diamond hands|ape/gi;
const ANXIETY_PATTERN = /stressed|anxious|worried|can't sleep|panic/gi;
const DECISION_PATTERN = /can't decide|stuck|don't know what to|help me choose/gi;

export class SocialBehaviorExtractor extends SignalExtractor {
  readonly sourceTypes = ['social_media', 'reddit', 'twitter'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const posts = this.parsePosts(data);

    if (posts.length === 0) {
      return this.fallbackExtract(data);
    }

    const signals: BehavioralSignal[] = [];
    const totalPosts = posts.length;

    const riskPosts: Post[] = [];
    const anxietyPosts: Post[] = [];
    const decisionPosts: Post[] = [];
    let totalRiskHits = 0;
    let totalAnxietyHits = 0;
    let totalDecisionHits = 0;
    const coOccurrenceRiskAnxiety: Post[] = [];

    for (const post of posts) {
      const text = `${post.title} ${post.body}`.toLowerCase();
      const riskHits = (text.match(RISK_PATTERN) || []).length;
      const anxietyHits = (text.match(ANXIETY_PATTERN) || []).length;
      const decisionHits = (text.match(DECISION_PATTERN) || []).length;

      if (riskHits > 0) { riskPosts.push(post); totalRiskHits += riskHits; }
      if (anxietyHits > 0) { anxietyPosts.push(post); totalAnxietyHits += anxietyHits; }
      if (decisionHits > 0) { decisionPosts.push(post); totalDecisionHits += decisionHits; }

      if (riskHits > 0 && anxietyHits > 0) coOccurrenceRiskAnxiety.push(post);
    }

    if (totalRiskHits > 0) {
      const ts = riskPosts.map(p => p.timestamp);
      const latestTimestamp = this.getLatestTimestamp(ts);
      const temporal = analyzeTemporalPatterns(ts);
      const trendPoints = this.buildTrendPoints(riskPosts, RISK_PATTERN);
      const coOcc: string[] = [];
      if (coOccurrenceRiskAnxiety.length > 0) coOcc.push('anxiety');

      signals.push(
        this.createSignal(
          'cognitive_trait',
          'high_risk_tolerance',
          scaleConfidence(riskPosts.length, totalPosts, 0.75),
          `${totalRiskHits} risk keywords across ${riskPosts.length}/${totalPosts} posts`,
          data.sourceId,
          {
            category: 'psychology',
            frequency: totalRiskHits,
            recurrence: calculateRecurrence(riskPosts.length, totalPosts),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
            coOccurrence: coOcc.length > 0 ? coOcc : undefined,
          },
          latestTimestamp,
        ),
      );
    }

    if (totalAnxietyHits > 0) {
      const ts = anxietyPosts.map(p => p.timestamp);
      const latestTimestamp = this.getLatestTimestamp(ts);
      const temporal = analyzeTemporalPatterns(ts);
      const trendPoints = this.buildTrendPoints(anxietyPosts, ANXIETY_PATTERN);
      const coOcc: string[] = [];
      if (coOccurrenceRiskAnxiety.length > 0) coOcc.push('high_risk_tolerance');

      signals.push(
        this.createSignal(
          'emotional_state',
          'anxiety',
          scaleConfidence(anxietyPosts.length, totalPosts, 0.7),
          `${totalAnxietyHits} anxiety keywords across ${anxietyPosts.length}/${totalPosts} posts`,
          data.sourceId,
          {
            category: 'psychology',
            sentiment: 'negative',
            frequency: totalAnxietyHits,
            recurrence: calculateRecurrence(anxietyPosts.length, totalPosts),
            temporalCluster: temporal.dominantCluster,
            intensityTrend: detectTrend(trendPoints),
            coOccurrence: coOcc.length > 0 ? coOcc : undefined,
          },
          latestTimestamp,
        ),
      );
    }

    if (totalDecisionHits > 0) {
      const ts = decisionPosts.map(p => p.timestamp);
      const latestTimestamp = this.getLatestTimestamp(ts);
      const temporal = analyzeTemporalPatterns(ts);

      signals.push(
        this.createSignal(
          'cognitive_trait',
          'decision_paralysis',
          scaleConfidence(decisionPosts.length, totalPosts, 0.65),
          `${totalDecisionHits} indecision keywords across ${decisionPosts.length}/${totalPosts} posts`,
          data.sourceId,
          {
            category: 'psychology',
            frequency: totalDecisionHits,
            recurrence: calculateRecurrence(decisionPosts.length, totalPosts),
            temporalCluster: temporal.dominantCluster,
          },
          latestTimestamp,
        ),
      );
    }

    const postCount = (data.metadata as { postCount?: number }).postCount || totalPosts;
    if (postCount > 50) {
      const latestTimestamp = this.getLatestTimestamp(posts.map(post => post.timestamp));
      signals.push(
        this.createSignal(
          'social_pattern',
          'high_social_engagement',
          0.6,
          `High volume of social activity: ${postCount} posts`,
          data.sourceId,
          { category: 'social', frequency: postCount },
          latestTimestamp,
        ),
      );
    }

    return signals;
  }

  private parsePosts(data: RawSourceData): Post[] {
    try {
      const parsed = JSON.parse(data.rawContent);
      const arr: unknown[] = parsed.posts || (Array.isArray(parsed) ? parsed : []);
      return arr
        .filter((e: any) => e && (typeof e.body === 'string' || typeof e.title === 'string'))
        .map((e: any) => ({
          body: e.body || '',
          title: e.title || '',
          timestamp: e.timestamp || e.created_utc || '',
        }));
    } catch {
      return [];
    }
  }

  private buildTrendPoints(posts: Post[], pattern: RegExp): Array<{ timestamp: string; value: number }> {
    return posts
      .filter(p => p.timestamp)
      .map(p => ({
        timestamp: p.timestamp,
        value: (`${p.title} ${p.body}`.toLowerCase().match(new RegExp(pattern.source, 'gi')) || []).length,
      }));
  }

  private fallbackExtract(data: RawSourceData): BehavioralSignal[] {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent.toLowerCase();

    if (RISK_PATTERN.test(content)) {
      RISK_PATTERN.lastIndex = 0;
      signals.push(this.createSignal('cognitive_trait', 'high_risk_tolerance', 0.45, 'Social media language indicates risk-seeking behavior', data.sourceId, { category: 'psychology' }, data.metadata?.timestamp));
    }
    if (ANXIETY_PATTERN.test(content)) {
      ANXIETY_PATTERN.lastIndex = 0;
      signals.push(this.createSignal('emotional_state', 'anxiety', 0.42, 'Expressions of stress or anxiety detected', data.sourceId, { category: 'psychology', sentiment: 'negative' }, data.metadata?.timestamp));
    }
    if (DECISION_PATTERN.test(content)) {
      DECISION_PATTERN.lastIndex = 0;
      signals.push(this.createSignal('cognitive_trait', 'decision_paralysis', 0.39, 'Indecision patterns in posts', data.sourceId, { category: 'psychology' }, data.metadata?.timestamp));
    }

    const postCount = (data.metadata as { postCount?: number }).postCount || 1;
    if (postCount > 50) {
      signals.push(this.createSignal('social_pattern', 'high_social_engagement', 0.6, `High volume of social activity: ${postCount} posts`, data.sourceId, { category: 'social' }, data.metadata?.timestamp));
    }
    return signals;
  }
}
