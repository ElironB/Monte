import { cacheGet, cacheSet } from '../config/redis.js';
import type { BehavioralDimensions } from '../persona/dimensionMapper.js';
import { EmbeddingService } from './embeddingService.js';

export interface ConceptEmbeddings {
  [dimension: string]: { high: number[]; low: number[] };
}

export const DIMENSION_CONCEPTS: Record<keyof BehavioralDimensions, {
  highDescription: string;
  lowDescription: string;
}> = {
  riskTolerance: {
    highDescription: 'willingness to take risks, gambling instinct, YOLO investing, comfort with uncertainty, volatile investments, speculative trading, high-stakes decisions, thrill-seeking behavior, aggressive financial moves, betting against the odds, living on the edge, embracing chaos',
    lowDescription: 'risk aversion, conservative investing, safety-first mindset, avoiding uncertainty, stable and predictable choices, loss aversion, preferring guarantees, saving over spending, defensive financial strategy, fear of losing money',
  },
  timePreference: {
    highDescription: 'wanting things now, instant gratification, impulsive purchasing, short-term thinking, impatience, inability to delay rewards, spending today rather than saving, urgency-driven decisions, live-for-the-moment attitude',
    lowDescription: 'delayed gratification, long-term planning, patient investing, saving for the future, goal-oriented discipline, willingness to wait for better outcomes, strategic patience, compound growth mindset',
  },
  socialDependency: {
    highDescription: 'seeking social approval, group-oriented decisions, peer pressure influence, validation from others, following trends, social media driven, conformity, relying on others opinions, collaborative decision making, herd mentality',
    lowDescription: 'independent thinking, solo decision making, contrarian views, self-reliant, ignoring social pressure, autonomous choices, lone wolf mentality, comfortable going against the crowd',
  },
  learningStyle: {
    highDescription: 'theoretical learning, academic study, research-oriented, reading documentation, structured education, formal courses, intellectual curiosity, analytical frameworks, conceptual understanding before action',
    lowDescription: 'learning by doing, experiential knowledge, trial and error, hands-on practice, jump in and figure it out, practical over theoretical, action-oriented learning, intuitive understanding',
  },
  decisionSpeed: {
    highDescription: 'making decisions quickly, impulsive choices, snap judgments, acting on gut feeling, ready fire aim mentality, decisive and fast, skipping analysis, bias toward action, hate overthinking',
    lowDescription: 'analysis paralysis, overthinking decisions, extensive research before choosing, deliberative process, careful weighing of options, slow and methodical, fear of making wrong choice, procrastinating on decisions',
  },
  emotionalVolatility: {
    highDescription: 'emotional reactions, mood swings, stress-driven decisions, anxiety about outcomes, panic selling, emotional spending, reactive behavior, letting feelings drive choices, fear and greed cycles, volatile emotional state',
    lowDescription: 'emotional stability, calm under pressure, stoic decision making, rational despite stress, even-tempered, disciplined emotional control, detached analysis, unaffected by market swings',
  },
};

const CONCEPT_CACHE_KEY = 'dimension_concept_embeddings_v1';

let cachedConcepts: ConceptEmbeddings | null = null;

export async function getDimensionConceptEmbeddings(): Promise<ConceptEmbeddings> {
  if (cachedConcepts) {
    return cachedConcepts;
  }

  const cached = await cacheGet<ConceptEmbeddings>(CONCEPT_CACHE_KEY);
  if (cached) {
    cachedConcepts = cached;
    return cached;
  }

  const service = EmbeddingService.getInstance();
  const concepts: ConceptEmbeddings = {};
  const allTexts: string[] = [];
  const keys: Array<{ dim: string; pole: 'high' | 'low' }> = [];

  for (const [dim, desc] of Object.entries(DIMENSION_CONCEPTS)) {
    allTexts.push(desc.highDescription);
    keys.push({ dim, pole: 'high' });
    allTexts.push(desc.lowDescription);
    keys.push({ dim, pole: 'low' });
  }

  const embeddings = await service.embedBatch(allTexts);

  for (let i = 0; i < keys.length; i++) {
    const { dim, pole } = keys[i];
    if (!concepts[dim]) {
      concepts[dim] = { high: [], low: [] };
    }
    concepts[dim][pole] = embeddings[i];
  }

  cachedConcepts = concepts;
  await cacheSet(CONCEPT_CACHE_KEY, concepts, 86400 * 30);
  return concepts;
}
