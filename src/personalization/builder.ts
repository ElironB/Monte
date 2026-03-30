import type { DimensionScore } from '../persona/personaCompressor.js';
import type { PsychologicalProfile } from '../persona/psychologyLayer.js';

export const PERSONALIZATION_SCHEMA_VERSION = 'personalization.v1';
export const PERSONALIZATION_MODES = ['general', 'decision', 'writing', 'planning', 'learning'] as const;

export type PersonalizationMode = typeof PERSONALIZATION_MODES[number];
export type PersonalizationLevel = 'low' | 'medium' | 'high';
export type PersonalizationTone = 'supportive' | 'neutral' | 'direct';
export type PersonalizationAutonomy = 'agent-led' | 'shared' | 'user-led';
export type PersonalizationClarificationStyle = 'ask-early' | 'ask-when-blocked' | 'infer-when-safe';
export type PersonalizationChallengeStyle = 'gentle' | 'balanced' | 'direct';
export type PersonalizationOptionCount = 'few' | 'moderate' | 'many';
export type PersonalizationPace = 'fast' | 'balanced' | 'deliberate';
export type PersonalizationRiskFrame = 'upside-first' | 'balanced' | 'downside-first';
export type PersonalizationBootstrapStatus = 'needs_ingestion' | 'needs_persona' | 'building' | 'ready' | 'failed';
export type PersonalizationRecommendedSurface = 'personalize_context' | 'monte_decide';

export interface PersonalizationSignal {
  value: string;
  type: string;
  confidence: number;
}

export interface PersonalizationSeed {
  personaId: string;
  version: number;
  summary: string;
  riskProfile: string;
  timeHorizon: string;
  behavioralFingerprint: Record<string, number>;
  dimensionScores: Record<string, DimensionScore>;
  dominantTraits: string[];
  keyContradictions: string[];
  psychologicalProfile: PsychologicalProfile | null;
  signalCount: number;
  sourceCount: number;
  sourceTypes: string[];
  signals: PersonalizationSignal[];
}

export interface PersonalizationGuidance {
  communication: {
    directness: PersonalizationLevel;
    structure: PersonalizationLevel;
    verbosity: PersonalizationLevel;
    tone: PersonalizationTone;
  };
  collaboration: {
    autonomy: PersonalizationAutonomy;
    clarificationStyle: PersonalizationClarificationStyle;
    challengeStyle: PersonalizationChallengeStyle;
    optionCount: PersonalizationOptionCount;
  };
  decisioning: {
    pace: PersonalizationPace;
    riskFrame: PersonalizationRiskFrame;
    reassuranceNeed: PersonalizationLevel;
  };
  do: string[];
  dont: string[];
  watchouts: string[];
}

export interface PersonalizationSourceCoverage {
  signalCount: number;
  sourceCount: number;
  sourceTypes: string[];
}

export interface PersonalizationProfile {
  personaId: string;
  version: number;
  summary: string;
  riskProfile: string;
  timeHorizon: string;
  behavioralFingerprint: Record<string, number>;
  dimensionScores: Record<string, DimensionScore>;
  dominantTraits: string[];
  keyContradictions: string[];
  psychologicalProfile: PsychologicalProfile | null;
  sourceCoverage: PersonalizationSourceCoverage;
  lowConfidenceDimensions: string[];
  guidance: PersonalizationGuidance;
  instructionBlock: string;
}

export interface PersonalizationTaskAdaptation {
  modeSummary: string;
  emphasis: string[];
  responseShape: string;
  guardrails: string[];
  do: string[];
  dont: string[];
}

export interface PersonalizationProfilePayload {
  ok: true;
  schemaVersion: typeof PERSONALIZATION_SCHEMA_VERSION;
  profile: PersonalizationProfile;
}

export interface PersonalizationContextPayload {
  ok: true;
  schemaVersion: typeof PERSONALIZATION_SCHEMA_VERSION;
  mode: PersonalizationMode;
  task: string;
  profile: PersonalizationProfile;
  taskAdaptation: PersonalizationTaskAdaptation;
  instructionBlock: string;
}

export interface PersonalizationBootstrapPayload {
  ok: true;
  schemaVersion: typeof PERSONALIZATION_SCHEMA_VERSION;
  status: PersonalizationBootstrapStatus;
  task: string;
  mode: PersonalizationMode;
  recommendedSurface: PersonalizationRecommendedSurface;
  nextAction: {
    command: string;
    description: string;
  };
  reasonIfNotReady?: string;
  profile?: PersonalizationProfile;
  taskAdaptation?: PersonalizationTaskAdaptation;
  instructionBlock: string;
}

const LOW_CONFIDENCE_THRESHOLD = 0.45;
const HIGH_THRESHOLD = 0.68;
const LOW_THRESHOLD = 0.42;

const MODE_PATTERNS: Array<{ mode: PersonalizationMode; pattern: RegExp }> = [
  { mode: 'decision', pattern: /\b(should i|decide|decision|choose|option|trade[- ]?off|worth it|whether to|pick between)\b/i },
  { mode: 'planning', pattern: /\b(plan|roadmap|milestone|sequence|timeline|next steps|prioriti[sz]e|organize)\b/i },
  { mode: 'writing', pattern: /\b(write|rewrite|draft|edit|email|message|post|copy|caption|tweet|essay|article)\b/i },
  { mode: 'learning', pattern: /\b(explain|teach|learn|understand|walk me through|break down|why does|how does)\b/i },
];

const EXPLICIT_SIMULATION_PATTERNS = [
  /\b(simulate|simulation|scenario graph|clone(?:s)?|outcome distribution)\b/i,
  /\b(monte decide|run monte decide|use monte decide|decision engine)\b/i,
  /\b(evidence loop|rerun this decision|apply evidence)\b/i,
];

function clamp(value: number, min: number = 0, max: number = 1): number {
  return Math.max(min, Math.min(max, value));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function first<T>(values: T[]): T | undefined {
  return values.length > 0 ? values[0] : undefined;
}

function getDimension(seed: PersonalizationSeed, key: string, fallback: number = 0.5): number {
  const raw = seed.behavioralFingerprint[key];
  return typeof raw === 'number' ? clamp(raw) : fallback;
}

function signalConfidence(seed: PersonalizationSeed, ...signalValues: string[]): number {
  let highest = 0;
  for (const signal of seed.signals) {
    if (signalValues.includes(signal.value) && signal.confidence > highest) {
      highest = signal.confidence;
    }
  }
  return highest;
}

function hasSignal(seed: PersonalizationSeed, signalValue: string, minConfidence: number = 0.5): boolean {
  return signalConfidence(seed, signalValue) >= minConfidence;
}

function getHighSeverityRiskFlags(seed: PersonalizationSeed): string[] {
  return (seed.psychologicalProfile?.riskFlags ?? [])
    .filter((flag) => flag.severity === 'high')
    .map((flag) => flag.description);
}

function getLowConfidenceDimensions(seed: PersonalizationSeed): string[] {
  return Object.entries(seed.dimensionScores)
    .filter(([, score]) => (score?.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD)
    .map(([dimension]) => dimension)
    .sort();
}

function deriveCommunication(seed: PersonalizationSeed, lowConfidenceDimensions: string[]) {
  const learningStyle = getDimension(seed, 'learningStyle');
  const informationSeeking = getDimension(seed, 'informationSeeking');
  const decisionSpeed = getDimension(seed, 'decisionSpeed');
  const emotionalVolatility = getDimension(seed, 'emotionalVolatility');
  const socialDependency = getDimension(seed, 'socialDependency');
  const attachmentStyle = seed.psychologicalProfile?.attachment.style;

  const structure = hasSignal(seed, 'structured_thinker')
    || hasSignal(seed, 'systematic_planner')
    || learningStyle >= HIGH_THRESHOLD
    ? 'high'
    : hasSignal(seed, 'freeform_thinker')
      || (hasSignal(seed, 'intuitive_communicator') && learningStyle <= LOW_THRESHOLD)
      ? 'low'
      : 'medium';

  const verbosity = informationSeeking >= HIGH_THRESHOLD
    || learningStyle >= HIGH_THRESHOLD
    || hasSignal(seed, 'validation_seeking')
    || hasSignal(seed, 'decision_paralysis')
    ? 'high'
    : decisionSpeed >= HIGH_THRESHOLD && !hasSignal(seed, 'learning_focused')
      ? 'low'
      : 'medium';

  const directness = decisionSpeed >= HIGH_THRESHOLD
    && emotionalVolatility < 0.55
    && attachmentStyle !== 'anxious'
    && attachmentStyle !== 'disorganized'
    ? 'high'
    : emotionalVolatility >= 0.62 || hasSignal(seed, 'anxiety') || lowConfidenceDimensions.length >= 4
      ? 'low'
      : 'medium';

  const tone = emotionalVolatility >= 0.62
    || attachmentStyle === 'anxious'
    || attachmentStyle === 'disorganized'
    || hasSignal(seed, 'anxiety')
    || hasSignal(seed, 'frustration')
    ? 'supportive'
    : directness === 'high' && socialDependency < 0.45
      ? 'direct'
      : 'neutral';

  return { directness, structure, verbosity, tone } as const;
}

function deriveCollaboration(
  seed: PersonalizationSeed,
  communication: PersonalizationGuidance['communication'],
  lowConfidenceDimensions: string[],
) {
  const socialDependency = getDimension(seed, 'socialDependency');
  const emotionalVolatility = getDimension(seed, 'emotionalVolatility');
  const decisionSpeed = getDimension(seed, 'decisionSpeed');
  const stressResponse = getDimension(seed, 'stressResponse');

  const autonomy = hasSignal(seed, 'delegation_reliance') && !hasSignal(seed, 'validation_seeking')
    ? 'agent-led'
    : hasSignal(seed, 'collaborative_thinker') || socialDependency > 0.55
      ? 'shared'
      : 'user-led';

  const clarificationStyle = emotionalVolatility >= 0.65
    || hasSignal(seed, 'anxiety')
    || hasSignal(seed, 'budget_struggles')
    || lowConfidenceDimensions.length >= 3
    ? 'ask-early'
    : autonomy === 'agent-led' && emotionalVolatility < 0.55
      ? 'infer-when-safe'
      : 'ask-when-blocked';

  const challengeStyle = communication.tone === 'supportive'
    || hasSignal(seed, 'anxiety')
    || stressResponse > 0.65
    ? 'gentle'
    : communication.directness === 'high' && socialDependency < 0.45
      ? 'direct'
      : 'balanced';

  const optionCount = decisionSpeed > 0.7
    || stressResponse > 0.65
    || hasSignal(seed, 'decision_paralysis')
    ? 'few'
    : getDimension(seed, 'informationSeeking') > 0.65 || getDimension(seed, 'learningStyle') > 0.65
      ? 'many'
      : 'moderate';

  return { autonomy, clarificationStyle, challengeStyle, optionCount } as const;
}

function deriveDecisioning(seed: PersonalizationSeed, communication: PersonalizationGuidance['communication']) {
  const decisionSpeed = getDimension(seed, 'decisionSpeed');
  const riskTolerance = getDimension(seed, 'riskTolerance');
  const emotionalVolatility = getDimension(seed, 'emotionalVolatility');
  const informationSeeking = getDimension(seed, 'informationSeeking');
  const locus = seed.psychologicalProfile?.locusOfControl.type;
  const attachmentStyle = seed.psychologicalProfile?.attachment.style;
  const hasHighRiskFlags = getHighSeverityRiskFlags(seed).length > 0;

  const pace = decisionSpeed < 0.4
    || informationSeeking > 0.7
    || hasSignal(seed, 'decision_paralysis')
    || hasSignal(seed, 'validation_seeking')
    ? 'deliberate'
    : decisionSpeed > 0.72 && emotionalVolatility < 0.55
      ? 'fast'
      : 'balanced';

  const riskFrame = riskTolerance < 0.45
    || emotionalVolatility >= 0.62
    || hasHighRiskFlags
    || hasSignal(seed, 'budget_struggles')
    || hasSignal(seed, 'anxiety')
    ? 'downside-first'
    : riskTolerance > HIGH_THRESHOLD && !hasSignal(seed, 'anxiety') && !hasSignal(seed, 'budget_struggles')
      ? 'upside-first'
      : 'balanced';

  const reassuranceNeed = communication.tone === 'supportive'
    || attachmentStyle === 'anxious'
    || attachmentStyle === 'disorganized'
    || hasSignal(seed, 'validation_seeking')
    || hasSignal(seed, 'anxiety')
    || hasSignal(seed, 'frustration')
    ? 'high'
    : locus === 'internal' && emotionalVolatility < 0.45
      ? 'low'
      : 'medium';

  return { pace, riskFrame, reassuranceNeed } as const;
}

function buildGuidance(seed: PersonalizationSeed, lowConfidenceDimensions: string[]): PersonalizationGuidance {
  const communication = deriveCommunication(seed, lowConfidenceDimensions);
  const collaboration = deriveCollaboration(seed, communication, lowConfidenceDimensions);
  const decisioning = deriveDecisioning(seed, communication);

  const doItems: string[] = [];
  const dontItems: string[] = [
    'Do not present soft persona inferences as certainties.',
  ];
  const watchouts: string[] = [];

  doItems.push(
    communication.directness === 'high'
      ? 'Lead with the answer or recommendation early.'
      : 'Ease into recommendations with a short rationale first.',
  );
  doItems.push(
    communication.structure === 'high'
      ? 'Use headings, bullets, or steps for multi-part responses.'
      : 'Keep the structure light and conversational unless the task is complex.',
  );
  doItems.push(
    collaboration.autonomy === 'agent-led'
      ? 'Take initiative when the task is clear and well-bounded.'
      : collaboration.autonomy === 'shared'
        ? 'Collaborate and checkpoint before major pivots.'
        : 'Leave room for the user to steer important choices.',
  );
  doItems.push(
    decisioning.reassuranceNeed === 'high'
      ? 'Acknowledge uncertainty and reassure before pushing commitment.'
      : 'Be confident when the evidence is strong, but stay transparent about tradeoffs.',
  );

  if (collaboration.optionCount === 'few') {
    dontItems.push('Do not flood the user with too many alternatives at once.');
  } else if (collaboration.optionCount === 'many') {
    doItems.push('Offer multiple approaches when the tradeoffs are genuinely meaningful.');
  }

  if (decisioning.riskFrame === 'downside-first') {
    dontItems.push('Do not ignore downside, reversibility, or execution cost.');
  } else if (decisioning.riskFrame === 'upside-first') {
    doItems.push('Make upside and momentum visible instead of over-indexing on caveats.');
  }

  if (communication.tone === 'supportive') {
    dontItems.push('Do not use harsh, judgmental, or abrupt phrasing.');
  }

  for (const dimension of lowConfidenceDimensions.slice(0, 3)) {
    watchouts.push(`Treat ${dimension} as provisional because the current evidence is limited.`);
  }

  if (seed.sourceCount < 2) {
    watchouts.push('The persona is built from narrow source coverage, so personalization should stay lightweight.');
  }

  const firstContradiction = first(seed.keyContradictions);
  if (firstContradiction) {
    watchouts.push(`Expect some internal tension around: ${firstContradiction}`);
  }

  for (const description of getHighSeverityRiskFlags(seed).slice(0, 2)) {
    watchouts.push(description);
  }

  return {
    communication,
    collaboration,
    decisioning,
    do: uniqueStrings(doItems),
    dont: uniqueStrings(dontItems),
    watchouts: uniqueStrings(watchouts),
  };
}

function buildProfileInstructionBlock(
  profile: PersonalizationProfile,
  agentName: string = 'the agent',
  taskAdaptation?: PersonalizationTaskAdaptation,
): string {
  const lines = [
    `You are ${agentName}. Personalize how you help this user using the profile below.`,
    '',
    '## User Personalization',
    `- Summary: ${profile.summary}`,
    `- Risk profile: ${profile.riskProfile}`,
    `- Time horizon: ${profile.timeHorizon}`,
    `- Dominant traits: ${profile.dominantTraits.join(', ') || 'none identified'}`,
    `- Key contradictions: ${profile.keyContradictions.join(' | ') || 'none identified'}`,
    '',
    '## Preferred Interaction Style',
    `- Directness: ${profile.guidance.communication.directness}`,
    `- Structure: ${profile.guidance.communication.structure}`,
    `- Verbosity: ${profile.guidance.communication.verbosity}`,
    `- Tone: ${profile.guidance.communication.tone}`,
    `- Autonomy: ${profile.guidance.collaboration.autonomy}`,
    `- Clarification style: ${profile.guidance.collaboration.clarificationStyle}`,
    `- Challenge style: ${profile.guidance.collaboration.challengeStyle}`,
    `- Option count: ${profile.guidance.collaboration.optionCount}`,
    `- Decision pace: ${profile.guidance.decisioning.pace}`,
    `- Risk framing: ${profile.guidance.decisioning.riskFrame}`,
    `- Reassurance need: ${profile.guidance.decisioning.reassuranceNeed}`,
    '',
    '## Avoid',
    ...profile.guidance.dont.map((item) => `- ${item}`),
  ];

  if (taskAdaptation) {
    lines.push(
      '',
      '## Task Adjustments',
      `- Mode: ${taskAdaptation.modeSummary}`,
      `- Response shape: ${taskAdaptation.responseShape}`,
      ...taskAdaptation.emphasis.map((item) => `- Emphasize: ${item}`),
      ...taskAdaptation.guardrails.map((item) => `- Guardrail: ${item}`),
    );
  }

  return lines.join('\n');
}

function buildBootstrapInstructionBlock(options: {
  status: PersonalizationBootstrapStatus;
  recommendedSurface: PersonalizationRecommendedSurface;
  nextAction: { command: string; description: string };
  reasonIfNotReady?: string;
  profile?: PersonalizationProfile;
  taskAdaptation?: PersonalizationTaskAdaptation;
  agentName?: string;
}): string {
  const lines = [
    `You are ${options.agentName ?? 'the agent'}.`,
    '',
    '## Monte Bootstrap',
    `- Status: ${options.status}`,
    `- Preferred surface for this task: ${options.recommendedSurface}`,
    '- Default to `monte personalize context` for task adaptation.',
    '- Use `monte decide` only for explicit simulation-style judgment calls.',
    `- Next action: ${options.nextAction.command} (${options.nextAction.description})`,
  ];

  if (options.reasonIfNotReady) {
    lines.push(`- Blocker: ${options.reasonIfNotReady}`);
  }

  if (options.profile && options.taskAdaptation) {
    lines.push(
      '',
      '## Task Guidance',
      `- Mode: ${options.taskAdaptation.modeSummary}`,
      `- Response shape: ${options.taskAdaptation.responseShape}`,
      ...options.taskAdaptation.emphasis.map((item) => `- Emphasize: ${item}`),
      ...options.taskAdaptation.guardrails.map((item) => `- Guardrail: ${item}`),
      '',
      buildProfileInstructionBlock(options.profile, options.agentName ?? 'the agent', options.taskAdaptation),
    );
  }

  return lines.join('\n');
}

export function buildTaskAdaptation(mode: PersonalizationMode): PersonalizationTaskAdaptation {
  switch (mode) {
    case 'decision':
      return {
        modeSummary: 'Decision support mode: synthesize the call, surface downside, and keep the next step actionable.',
        emphasis: [
          'State the recommendation early when confidence is good.',
          'Show downside, reversibility, and opportunity cost clearly.',
          'Prefer experiments and next actions over abstract theorizing.',
        ],
        responseShape: 'Recommendation -> rationale -> downside -> next step.',
        guardrails: [
          'Do not offload the final synthesis back to the user without taking a stance.',
          'Do not hide uncertainty or persona conflict.',
        ],
        do: [
          'Point out the key tradeoff explicitly.',
          'Name the next concrete move that reduces uncertainty.',
        ],
        dont: [
          'Do not produce a vague pros-and-cons dump with no judgment.',
          'Do not skip downside and reversibility.',
        ],
      };
    case 'writing':
      return {
        modeSummary: 'Writing mode: match tone, shape, and audience fit while keeping the draft easy to accept.',
        emphasis: [
          'Preserve the user-preferred tone and structure.',
          'Make the first draft usable before offering alternatives.',
          'Use examples and rewrites when they reduce friction.',
        ],
        responseShape: 'Draft first -> optional refinement notes -> optional alternate versions.',
        guardrails: [
          'Do not over-style the output if the user prefers directness.',
          'Do not bury the usable draft under commentary.',
        ],
        do: [
          'Keep the first pass close to ready-to-send.',
          'Offer one or two alternatives only when they add clear value.',
        ],
        dont: [
          'Do not default to overly polished or generic AI prose.',
          'Do not multiply options unless the task is exploratory.',
        ],
      };
    case 'planning':
      return {
        modeSummary: 'Planning mode: turn ambiguity into sequence, milestones, and next actions.',
        emphasis: [
          'Break work into phases with clear next steps.',
          'Highlight dependencies, bottlenecks, and decision points.',
          'Keep the plan practical rather than aspirational.',
        ],
        responseShape: 'Outcome -> phases -> immediate next steps -> risks.',
        guardrails: [
          'Do not create bloated plans with no clear starting point.',
          'Do not hide assumptions that affect sequencing.',
        ],
        do: [
          'Identify the first step that creates momentum.',
          'Keep the plan scoped to what the user can actually execute.',
        ],
        dont: [
          'Do not produce a long roadmap with no prioritization.',
          'Do not skip execution risk and follow-through concerns.',
        ],
      };
    case 'learning':
      return {
        modeSummary: 'Learning mode: explain clearly, stage complexity, and reinforce understanding.',
        emphasis: [
          'Start from the core idea, then layer detail.',
          'Use examples, analogies, and concrete consequences.',
          'Check complexity against the user profile before going deep.',
        ],
        responseShape: 'Core concept -> example -> deeper detail -> practical takeaway.',
        guardrails: [
          'Do not assume the user wants maximal detail by default.',
          'Do not use jargon without grounding it.',
        ],
        do: [
          'Teach in layers so the user can stop early and still get value.',
          'Use examples when they clarify abstract points.',
        ],
        dont: [
          'Do not jump straight into dense theory.',
          'Do not mistake verbosity for helpfulness.',
        ],
      };
    case 'general':
    default:
      return {
        modeSummary: 'General mode: apply the stable personalization profile without extra task-specific framing.',
        emphasis: [
          'Match tone, pacing, and structure to the user profile.',
          'Keep answers practical and easy to act on.',
        ],
        responseShape: 'Direct answer -> concise support -> next step when helpful.',
        guardrails: [
          'Do not overfit weak persona signals.',
          'Do not add unnecessary complexity when the task is simple.',
        ],
        do: [
          'Use the profile as guidance for how to answer, not as a substitute for the task itself.',
          'Prefer low-friction responses that the user can accept quickly.',
        ],
        dont: [
          'Do not mention the persona model unless the user asks.',
          'Do not turn simple requests into therapy or diagnosis.',
        ],
      };
  }
}

export function classifyTaskMode(task: string, additionalContext?: string): PersonalizationMode {
  const combined = `${task} ${additionalContext ?? ''}`.trim();
  for (const candidate of MODE_PATTERNS) {
    if (candidate.pattern.test(combined)) {
      return candidate.mode;
    }
  }
  return 'general';
}

export function classifyRecommendedSurface(task: string, additionalContext?: string): PersonalizationRecommendedSurface {
  const combined = `${task} ${additionalContext ?? ''}`.trim();
  return EXPLICIT_SIMULATION_PATTERNS.some((pattern) => pattern.test(combined))
    ? 'monte_decide'
    : 'personalize_context';
}

export function buildPersonalizationProfile(seed: PersonalizationSeed): PersonalizationProfile {
  const lowConfidenceDimensions = getLowConfidenceDimensions(seed);
  const guidance = buildGuidance(seed, lowConfidenceDimensions);

  const profile: PersonalizationProfile = {
    personaId: seed.personaId,
    version: seed.version,
    summary: seed.summary,
    riskProfile: seed.riskProfile,
    timeHorizon: seed.timeHorizon,
    behavioralFingerprint: seed.behavioralFingerprint,
    dimensionScores: seed.dimensionScores,
    dominantTraits: seed.dominantTraits,
    keyContradictions: seed.keyContradictions,
    psychologicalProfile: seed.psychologicalProfile,
    sourceCoverage: {
      signalCount: seed.signalCount,
      sourceCount: seed.sourceCount,
      sourceTypes: seed.sourceTypes,
    },
    lowConfidenceDimensions,
    guidance,
    instructionBlock: '',
  };

  profile.instructionBlock = buildProfileInstructionBlock(profile);
  return profile;
}

export function buildPersonalizationProfilePayload(seed: PersonalizationSeed): PersonalizationProfilePayload {
  return {
    ok: true,
    schemaVersion: PERSONALIZATION_SCHEMA_VERSION,
    profile: buildPersonalizationProfile(seed),
  };
}

export function buildPersonalizationContextPayload(
  seed: PersonalizationSeed,
  options: {
    task: string;
    mode?: PersonalizationMode;
    agentName?: string;
    additionalContext?: string;
  },
): PersonalizationContextPayload {
  const profile = buildPersonalizationProfile(seed);
  const mode = options.mode ?? classifyTaskMode(options.task, options.additionalContext);
  const taskAdaptation = buildTaskAdaptation(mode);

  return {
    ok: true,
    schemaVersion: PERSONALIZATION_SCHEMA_VERSION,
    mode,
    task: options.task,
    profile,
    taskAdaptation,
    instructionBlock: buildProfileInstructionBlock(profile, options.agentName ?? 'the agent', taskAdaptation),
  };
}

export function buildPersonalizationBootstrapPayload(options: {
  status: PersonalizationBootstrapStatus;
  task: string;
  nextAction: {
    command: string;
    description: string;
  };
  reasonIfNotReady?: string;
  seed?: PersonalizationSeed;
  mode?: PersonalizationMode;
  agentName?: string;
  additionalContext?: string;
}): PersonalizationBootstrapPayload {
  const mode = options.mode ?? classifyTaskMode(options.task, options.additionalContext);
  const recommendedSurface = classifyRecommendedSurface(options.task, options.additionalContext);

  if (!options.seed) {
    return {
      ok: true,
      schemaVersion: PERSONALIZATION_SCHEMA_VERSION,
      status: options.status,
      task: options.task,
      mode,
      recommendedSurface,
      nextAction: options.nextAction,
      reasonIfNotReady: options.reasonIfNotReady,
      instructionBlock: buildBootstrapInstructionBlock({
        status: options.status,
        recommendedSurface,
        nextAction: options.nextAction,
        reasonIfNotReady: options.reasonIfNotReady,
        agentName: options.agentName,
      }),
    };
  }

  const profile = buildPersonalizationProfile(options.seed);
  const taskAdaptation = buildTaskAdaptation(mode);

  return {
    ok: true,
    schemaVersion: PERSONALIZATION_SCHEMA_VERSION,
    status: options.status,
    task: options.task,
    mode,
    recommendedSurface,
    nextAction: options.nextAction,
    reasonIfNotReady: options.reasonIfNotReady,
    profile,
    taskAdaptation,
    instructionBlock: buildBootstrapInstructionBlock({
      status: options.status,
      recommendedSurface,
      nextAction: options.nextAction,
      reasonIfNotReady: options.reasonIfNotReady,
      profile,
      taskAdaptation,
      agentName: options.agentName,
    }),
  };
}
