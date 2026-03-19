import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import { calculateRecurrence } from './temporalUtils.js';

const REFLECTION_WORDS = ['feel', 'think', 'realized', 'learned', 'why', 'because'];
const GOAL_PATTERN = /goal|objective|target|plan.*202|q[1-4]/gi;
const DEADLINE_PATTERN = /by\s+(january|february|march|april|may|june|july|august|september|october|november|december|\w+\s+\d{4}|\d{4}-\d{2})/gi;
const METRIC_PATTERN = /\$[\d,]+|\d+%|\d+\s*(hours|days|weeks|months)/gi;

export class CognitiveStructureExtractor extends SignalExtractor {
  readonly sourceTypes = ['notes', 'obsidian', 'notion'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const signals: BehavioralSignal[] = [];
    const content = data.rawContent;
    const lower = content.toLowerCase();
    const wordCount = content.split(/\s+/).filter(Boolean).length;
    if (wordCount === 0) return signals;

    const headings = (content.match(/^#{1,6}\s+.+/gm) || []).length;
    const codeBlocks = (content.match(/```/g) || []).length / 2;
    const tables = (content.match(/\|[^|]+\|/g) || []).length;
    const lists = (content.match(/^[\s]*[-*+]\s+.+/gm) || []).length;
    const structureElements = headings + Math.floor(codeBlocks) + (tables > 0 ? 1 : 0) + lists;
    const structureDensity = structureElements / wordCount;

    if (structureElements >= 3 && wordCount > 200) {
      signals.push(
        this.createSignal(
          'cognitive_trait',
          'highly_organized',
          Math.min(0.95, 0.5 + structureDensity * 20),
          `${structureElements} structure elements (${headings} headings, ${Math.floor(codeBlocks)} code blocks, ${tables > 0 ? 1 : 0} tables, ${lists} list items) in ${wordCount} words`,
          data.sourceId,
          {
            category: 'cognition',
            frequency: structureElements,
            recurrence: calculateRecurrence(structureElements, Math.ceil(wordCount / 100)),
          },
        ),
      );
    } else if (structureElements < 2 && wordCount > 500) {
      signals.push(
        this.createSignal(
          'cognitive_trait',
          'freeform_thinker',
          Math.min(0.85, 0.5 + (1 - structureDensity) * 0.3),
          `Minimal structure (${structureElements} elements) in ${wordCount} words`,
          data.sourceId,
          { category: 'cognition', frequency: structureElements },
        ),
      );
    }

    const goalMatches = lower.match(GOAL_PATTERN) || [];
    const deadlineMatches = lower.match(DEADLINE_PATTERN) || [];
    const metricMatches = lower.match(METRIC_PATTERN) || [];

    if (goalMatches.length > 0) {
      const sections = content.split(/^#{1,3}\s+/m).filter(Boolean);
      const sectionsWithGoals = sections.filter(s => GOAL_PATTERN.test(s.toLowerCase())).length;
      GOAL_PATTERN.lastIndex = 0;

      const planningDepth =
        (deadlineMatches.length > 0 ? 0.15 : 0) +
        (metricMatches.length > 0 ? 0.15 : 0) +
        (headings > 3 ? 0.1 : 0);

      signals.push(
        this.createSignal(
          'cognitive_trait',
          'goal_oriented',
          Math.min(0.95, 0.5 + goalMatches.length * 0.05 + planningDepth),
          `${goalMatches.length} goal references across ${sectionsWithGoals} sections, ${deadlineMatches.length} deadlines, ${metricMatches.length} measurable targets`,
          data.sourceId,
          {
            category: 'cognition',
            frequency: goalMatches.length,
            recurrence: calculateRecurrence(sectionsWithGoals, sections.length),
          },
        ),
      );
    }

    let totalReflection = 0;
    const reflectionCounts: Record<string, number> = {};
    for (const word of REFLECTION_WORDS) {
      const count = (lower.match(new RegExp(word, 'g')) || []).length;
      reflectionCounts[word] = count;
      totalReflection += count;
    }
    const reflectionDensity = totalReflection / wordCount;

    if (totalReflection > 3) {
      signals.push(
        this.createSignal(
          'cognitive_trait',
          'deep_self_reflection',
          Math.min(0.95, 0.5 + reflectionDensity * 40),
          `${totalReflection} reflection words (density: ${(reflectionDensity * 100).toFixed(1)}%): ${Object.entries(reflectionCounts).filter(([, c]) => c > 0).map(([w, c]) => `${w}(${c})`).join(', ')}`,
          data.sourceId,
          {
            category: 'cognition',
            frequency: totalReflection,
            recurrence: calculateRecurrence(totalReflection, wordCount),
          },
        ),
      );
    }

    return signals;
  }
}
