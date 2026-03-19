export interface TemporalProfile {
  timeOfDay: { morning: number; afternoon: number; evening: number; lateNight: number };
  dayOfWeek: { weekday: number; weekend: number };
  dominantCluster: string;
  burstiness: number;
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
