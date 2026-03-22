import { BehavioralSignal } from '../types.js';
import { cosineSimilarity } from '../../embeddings/embeddingService.js';

export interface TemporalProfile {
  timeOfDay: { morning: number; afternoon: number; evening: number; lateNight: number };
  dayOfWeek: { weekday: number; weekend: number };
  dominantCluster: string;
  burstiness: number;
}

export interface SequentialPattern {
  signals: BehavioralSignal[];
  progressionScore: number;
}

export function parseTimestamp(raw: string): Date | null {
  if (!raw) return null;
  if (/^\d{10,13}$/.test(raw.trim())) {
    const n = Number(raw.trim());
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

export function analyzeTemporalPatterns(timestamps: string[]): TemporalProfile {
  const profile: TemporalProfile = {
    timeOfDay: { morning: 0, afternoon: 0, evening: 0, lateNight: 0 },
    dayOfWeek: { weekday: 0, weekend: 0 },
    dominantCluster: 'unknown',
    burstiness: 0,
  };

  const dates: Date[] = [];
  for (const ts of timestamps) {
    const d = parseTimestamp(ts);
    if (d) dates.push(d);
  }
  if (dates.length === 0) return profile;

  for (const d of dates) {
    const h = d.getUTCHours();
    if (h >= 5 && h < 12) profile.timeOfDay.morning++;
    else if (h >= 12 && h < 17) profile.timeOfDay.afternoon++;
    else if (h >= 17 && h < 22) profile.timeOfDay.evening++;
    else profile.timeOfDay.lateNight++;

    const day = d.getUTCDay();
    if (day === 0 || day === 6) profile.dayOfWeek.weekend++;
    else profile.dayOfWeek.weekday++;
  }

  const tod = profile.timeOfDay;
  const todEntries: [string, number][] = [
    ['morning', tod.morning],
    ['afternoon', tod.afternoon],
    ['evening', tod.evening],
    ['late_night', tod.lateNight],
  ];
  const dowEntries: [string, number][] = [
    ['weekday', profile.dayOfWeek.weekday],
    ['weekend', profile.dayOfWeek.weekend],
  ];

  const maxTod = todEntries.reduce((a, b) => (b[1] > a[1] ? b : a));
  const maxDow = dowEntries.reduce((a, b) => (b[1] > a[1] ? b : a));

  const total = dates.length;
  const todDominance = maxTod[1] / total;
  const dowDominance = maxDow[1] / total;

  profile.dominantCluster = todDominance >= dowDominance ? maxTod[0] : maxDow[0];

  if (dates.length >= 2) {
    dates.sort((a, b) => a.getTime() - b.getTime());
    const gaps: number[] = [];
    for (let i = 1; i < dates.length; i++) {
      gaps.push(dates[i].getTime() - dates[i - 1].getTime());
    }
    const meanGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    if (meanGap === 0) {
      profile.burstiness = 1;
    } else {
      const variance = gaps.reduce((s, g) => s + (g - meanGap) ** 2, 0) / gaps.length;
      const stdDev = Math.sqrt(variance);
      const cv = stdDev / meanGap;
      profile.burstiness = Math.min(1, cv / 2);
    }
  }

  return profile;
}

export function calculateRecurrence(matchCount: number, totalEntries: number): number {
  if (totalEntries === 0) return 0;
  return Math.min(1, matchCount / totalEntries);
}

export function detectTrend(
  timestampedValues: Array<{ timestamp: string; value: number }>
): 'increasing' | 'decreasing' | 'stable' {
  if (timestampedValues.length < 2) return 'stable';

  const points = timestampedValues
    .map(tv => ({ t: parseTimestamp(tv.timestamp)?.getTime() ?? 0, v: tv.value }))
    .filter(p => p.t > 0)
    .sort((a, b) => a.t - b.t);

  if (points.length < 2) return 'stable';

  const n = points.length;
  const meanT = points.reduce((s, p) => s + p.t, 0) / n;
  const meanV = points.reduce((s, p) => s + p.v, 0) / n;

  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.t - meanT) * (p.v - meanV);
    den += (p.t - meanT) ** 2;
  }

  if (den === 0) return 'stable';
  const slope = num / den;

  const timeRange = points[points.length - 1].t - points[0].t;
  if (timeRange === 0) return 'stable';

  const normalizedSlope = slope * timeRange;
  const valueRange = Math.max(...points.map(p => p.v)) - Math.min(...points.map(p => p.v));
  const threshold = valueRange > 0 ? valueRange * 0.1 : 0.05;

  if (normalizedSlope > threshold) return 'increasing';
  if (normalizedSlope < -threshold) return 'decreasing';
  return 'stable';
}

export function scaleConfidence(
  matchCount: number,
  totalEntries: number,
  baseConfidence: number,
  cap: number = 0.95
): number {
  if (totalEntries === 0) return baseConfidence;
  const ratio = matchCount / totalEntries;
  const volumeBoost = Math.min(1, Math.log2(totalEntries + 1) / 6);
  return Math.min(cap, baseConfidence * (0.4 + 0.6 * ratio) * (0.6 + 0.4 * volumeBoost));
}

export function detectSequences(
  signals: BehavioralSignal[],
  embeddings: Map<string, number[]>
): SequentialPattern[] {
  const sortedSignals = [...signals]
    .filter(s => parseTimestamp(s.timestamp))
    .sort((a, b) => parseTimestamp(a.timestamp)!.getTime() - parseTimestamp(b.timestamp)!.getTime());

  const sequences: SequentialPattern[] = [];
  const MAX_WINDOW_MS = 72 * 60 * 60 * 1000;
  const SIM_THRESHOLD = 0.4;

  let currentSeq: BehavioralSignal[] = [];

  for (const signal of sortedSignals) {
    if (currentSeq.length === 0) {
      currentSeq.push(signal);
      continue;
    }

    const lastSignal = currentSeq[currentSeq.length - 1];
    const tLast = parseTimestamp(lastSignal.timestamp)!.getTime();
    const tCurrent = parseTimestamp(signal.timestamp)!.getTime();

    const eLast = embeddings.get(lastSignal.id);
    const eCurrent = embeddings.get(signal.id);

    // Time window constraint
    if (tCurrent - tLast <= MAX_WINDOW_MS && eLast && eCurrent) {
      const sim = cosineSimilarity(eLast, eCurrent);
      if (sim > SIM_THRESHOLD) {
        currentSeq.push(signal);
        continue;
      }
    }

    // Window broken or constraint not met, process current sequence
    if (currentSeq.length > 1) {
      sequences.push({ signals: [...currentSeq], progressionScore: calculateProgressionScore(currentSeq, embeddings) });
    }
    currentSeq = [signal];
  }

  if (currentSeq.length > 1) {
    sequences.push({ signals: [...currentSeq], progressionScore: calculateProgressionScore(currentSeq, embeddings) });
  }

  return sequences;
}

function calculateProgressionScore(sequence: BehavioralSignal[], embeddings: Map<string, number[]>): number {
  if (sequence.length < 3) {
    return 0.5; // Neutral progression for brief sequences
  }

  function getMeanPairwiseDistance(signals: BehavioralSignal[]): number {
    let sumDist = 0;
    let pairs = 0;
    for (let i = 0; i < signals.length; i++) {
      for (let j = i + 1; j < signals.length; j++) {
        const ea = embeddings.get(signals[i].id);
        const eb = embeddings.get(signals[j].id);
        if (ea && eb) {
          sumDist += (1 - cosineSimilarity(ea, eb));
          pairs++;
        }
      }
    }
    return pairs > 0 ? sumDist / pairs : 0;
  }

  const firstHalf = sequence.slice(0, Math.ceil(sequence.length / 2));
  const lastHalf = sequence.slice(Math.floor(sequence.length / 2));

  // The formula specifies first 3 and last 3, but sequence can be shorter, so we use halves.
  const distFirst = getMeanPairwiseDistance(firstHalf);
  const distLast = getMeanPairwiseDistance(lastHalf);

  if (distFirst === 0) return 0.5;

  // progressionScore = 1 - (meanPairwiseDistance_last / meanPairwiseDistance_first)
  return 1 - (distLast / distFirst);
}

export interface CycleDetectionResult {
  periodDays: 7 | 14 | 30 | 90;
  phase: string;
  autocorrelationScore: number;
}

export interface Epoch {
  startDate: string;
  endDate: string;
  signalCount: number;
  dominantCluster: string;
}

export function detectCycles(signals: BehavioralSignal[], periods: number[] = [7, 14, 30, 90]): CycleDetectionResult[] {
  const dates = signals
    .map(s => parseTimestamp(s.timestamp))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length < 2) return [];

  const minTime = dates[0].getTime();
  const maxTime = dates[dates.length - 1].getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const numDays = Math.ceil((maxTime - minTime) / dayMs) || 1;
  const dailyCounts = new Array(numDays).fill(0);

  for (const d of dates) {
    const dayIndex = Math.floor((d.getTime() - minTime) / dayMs);
    dailyCounts[Math.min(dayIndex, numDays - 1)]++;
  }

  const results: CycleDetectionResult[] = [];
  const CYCLE_SIGNIFICANCE_THRESHOLD = 0.3;

  for (const period of periods) {
    if (numDays < period * 2) continue; // Need at least two full periods

    let meanOrig = 0;
    let meanShifted = 0;
    const n = numDays - period;
    
    for (let i = 0; i < n; i++) {
        meanOrig += dailyCounts[i];
        meanShifted += dailyCounts[i + period];
    }
    meanOrig /= n;
    meanShifted /= n;

    let num = 0, den1 = 0, den2 = 0;
    for (let i = 0; i < n; i++) {
        const diffOrig = dailyCounts[i] - meanOrig;
        const diffShifted = dailyCounts[i + period] - meanShifted;
        num += diffOrig * diffShifted;
        den1 += diffOrig * diffOrig;
        den2 += diffShifted * diffShifted;
    }

    const denom = Math.sqrt(den1 * den2);
    const correlation = denom === 0 ? 0 : num / denom;

    if (correlation > CYCLE_SIGNIFICANCE_THRESHOLD) {
      // Find phase (day of period with highest average count)
      const periodSums = new Array(period).fill(0);
      for (let i = 0; i < numDays; i++) {
          periodSums[i % period] += dailyCounts[i];
      }
      const maxSum = Math.max(...periodSums);
      const phaseIndex = periodSums.indexOf(maxSum);
      
      let phaseName = `Day ${phaseIndex + 1}`;
      if (period === 7) {
          const firstDay = new Date(minTime).getUTCDay();
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          phaseName = dayNames[(firstDay + phaseIndex) % 7];
      }

      results.push({
        periodDays: period as 7 | 14 | 30 | 90,
        phase: phaseName,
        autocorrelationScore: correlation
      });
    }
  }

  return results;
}

export function detectEpochs(signals: BehavioralSignal[]): Epoch[] {
  const sortedSignals = [...signals]
    .filter(s => parseTimestamp(s.timestamp))
    .sort((a, b) => parseTimestamp(a.timestamp)!.getTime() - parseTimestamp(b.timestamp)!.getTime());

  if (sortedSignals.length === 0) return [];

  const epochs: Epoch[] = [];
  let currentBlock: BehavioralSignal[] = [sortedSignals[0]];
  const MAX_GAP_MS = 30 * 24 * 60 * 60 * 1000;

  for (let i = 1; i < sortedSignals.length; i++) {
    const prevTime = parseTimestamp(sortedSignals[i - 1].timestamp)!.getTime();
    const currTime = parseTimestamp(sortedSignals[i].timestamp)!.getTime();

    if (currTime - prevTime > MAX_GAP_MS) {
      // Finalize block
      const start = parseTimestamp(currentBlock[0].timestamp)!.toISOString();
      const end = parseTimestamp(currentBlock[currentBlock.length - 1].timestamp)!.toISOString();
      const timestamps = currentBlock.map(s => s.timestamp);
      const profile = analyzeTemporalPatterns(timestamps);

      epochs.push({
        startDate: start,
        endDate: end,
        signalCount: currentBlock.length,
        dominantCluster: profile.dominantCluster
      });
      currentBlock = [];
    }
    currentBlock.push(sortedSignals[i]);
  }

  if (currentBlock.length > 0) {
    const start = parseTimestamp(currentBlock[0].timestamp)!.toISOString();
    const end = parseTimestamp(currentBlock[currentBlock.length - 1].timestamp)!.toISOString();
    const timestamps = currentBlock.map(s => s.timestamp);
    const profile = analyzeTemporalPatterns(timestamps);

    epochs.push({
      startDate: start,
      endDate: end,
      signalCount: currentBlock.length,
      dominantCluster: profile.dominantCluster
    });
  }

  return epochs;
}
