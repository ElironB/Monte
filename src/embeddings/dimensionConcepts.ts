import { cacheGet, cacheSet } from '../config/redis.js';
import type { BehavioralDimensions } from '../persona/dimensionMapper.js';
import { EmbeddingService } from './embeddingService.js';

export interface ConceptEmbeddings {
  [dimension: string]: { high: number[][]; low: number[][]; negative: number[][] };
}

export const DIMENSION_CONCEPTS: Record<keyof BehavioralDimensions, {
  highAnchors: string[];
  lowAnchors: string[];
  negativeAnchors: string[];
}> = {
  riskTolerance: {
    highAnchors: [
      "Willingness to take significant risks for potential high rewards",
      "Comfortable with uncertainty, speculation, and volatile investments",
      "Thrill-seeking behavior and aggressive financial or life decisions",
      "Prefers high-variance outcomes over safe guarantees",
      "Makes bold bets and goes all-in when given the chance"
    ],
    lowAnchors: [
      "Strong preference for safety, guarantees, and preservation of capital",
      "Aversion to uncertainty, unpredictable outcomes, and volatility",
      "Conservative decision making prioritizing security over potential gain",
      "Prefers stable, predictable environments and completely avoids risks",
      "Fear of losing money or making irreversible mistakes"
    ],
    negativeAnchors: [
      "I need to buy groceries today",
      "What is the weather like tomorrow",
      "My favorite programming language is TypeScript"
    ]
  },
  timePreference: {
    highAnchors: [
      "Strong desire for instant gratification and immediate rewards",
      "Impulsive choices prioritizing the present over the future",
      "Urgency-driven decisions with a live-for-the-moment attitude",
      "Spends money today rather than saving it for later",
      "Finds it extremely difficult to wait or delay gratification"
    ],
    lowAnchors: [
      "Willingness to delay gratification for long-term growth",
      "Strategic patience and disciplined planning for the future",
      "Saving and investing over immediate consumption",
      "Goal-oriented discipline spanning months or years",
      "Understands compound growth and acts with future-orientation"
    ],
    negativeAnchors: [
      "I woke up at 8 AM",
      "The color of the sky is blue",
      "Yesterday I watched a movie"
    ]
  },
  socialDependency: {
    highAnchors: [
      "Heavily relies on peer validation and social approval",
      "Makes decisions based on trends, conformity, and group consensus",
      "Highly influenced by social media and herd mentality",
      "Seeks advice and needs collaborative input before acting",
      "Fears social rejection and optimizes for fitting in"
    ],
    lowAnchors: [
      "Makes autonomous decisions completely independent of social pressure",
      "Self-reliant, contrarian, and comfortable going against the crowd",
      "Ignores external validation and relies on internal convictions",
      "Prefers working solo and completely trusts own judgment",
      "Comfortable being the lone wolf with unpopular opinions"
    ],
    negativeAnchors: [
      "The meeting is scheduled for 3 PM",
      "My laptop is currently charging",
      "Water boils at 100 degrees Celsius"
    ]
  },
  learningStyle: {
    highAnchors: [
      "Prefers rigorous academic study, documentation, and formal education",
      "Values conceptual understanding and theoretical frameworks before acting",
      "Research-oriented and deeply analytical in acquiring knowledge",
      "Reads textbooks and structured courses to gather information",
      "Intellectual curiosity driven by abstract concepts"
    ],
    lowAnchors: [
      "Learns best through hands-on trial and error and experiential practice",
      "Action-oriented approach pushing for practical implementation",
      "Relies on intuitive leaps rather than structured academic study",
      "Jumps straight into doing without reading the manual",
      "Values practical application and tinkering over theory"
    ],
    negativeAnchors: [
      "I ordered a pizza for dinner",
      "She went to the gym yesterday",
      "The dog is barking outside"
    ]
  },
  decisionSpeed: {
    highAnchors: [
      "Makes highly decisive, rapid choices with a strong bias toward action",
      "Acts immediately on gut feelings, skipping prolonged analysis",
      "Prefers moving fast and making snap judgments over overthinking",
      "Ready, fire, aim mentality towards new opportunities",
      "Hates analysis paralysis and wants forward momentum now"
    ],
    lowAnchors: [
      "Extensively deliberates and researches options before committing",
      "Prone to analysis paralysis and extremely slow, methodical choices",
      "Experiences high anxiety about making the wrong decision",
      "Requires perfect information and extensive pros/cons lists",
      "Procrastinates on choices to avoid the possibility of error"
    ],
    negativeAnchors: [
      "The cat is sleeping on the couch",
      "I need to drink more water",
      "This song is very popular right now"
    ]
  },
  emotionalVolatility: {
    highAnchors: [
      "Experiences severe mood swings and intense emotional reactivity",
      "Makes panic-driven or stress-induced decisions in chaotic situations",
      "Highly susceptible to fear and greed cycles affecting judgment",
      "Let emotions completely override rational planning",
      "Easily triggered, anxious, and reactive to bad news"
    ],
    lowAnchors: [
      "Maintains stoic emotional control and remains calm under severe pressure",
      "Highly rational and even-tempered in stressful or volatile situations",
      "Exercises disciplined detachment rather than reactive emotional swings",
      "Unaffected by market swings or chaotic external events",
      "Objective, analytical, and completely emotionally insulated"
    ],
    negativeAnchors: [
      "I bought a new pair of shoes",
      "The train arrives in 5 minutes",
      "We had coffee this morning"
    ]
  },
  executionGap: {
    highAnchors: [
      "Creates detailed plans and budgets but rarely follows through",
      "Has multiple abandoned projects spanning months",
      "Repeatedly revises deadlines without completing original commitment",
      "Sets ambitious goals in writing but behavior shows no progress",
      "Talks endlessly about ideas but struggles with daily execution"
    ],
    lowAnchors: [
      "Consistently follows through on stated plans and commitments",
      "Actual spending closely matches budgeted amounts over time",
      "Completes projects at a reliable rate after starting them",
      "Calendar commitments kept with minimal rescheduling",
      "High correlation between spoken intentions and completed actions"
    ],
    negativeAnchors: [
      "I like to play video games on the weekend",
      "Choosing between taking the bus or driving to work",
      "It is sunny today"
    ]
  },
  informationSeeking: {
    highAnchors: [
      "Obsessively gathers data and hunts for hidden truths before acting",
      "Devotes substantial time to cross-referencing multiple disparate sources",
      "Constantly questions face value information and digs deeper",
      "Falls down research rabbit holes reading everything on a topic",
      "Requires empirical evidence and thoroughly investigates claims"
    ],
    lowAnchors: [
      "Accepts first-page search results or single-source information blindly",
      "Shows zero interest in researching underlying causes or data",
      "Takes statements and consensus narratives at definitive face value",
      "Relies entirely on headlines without reading the article",
      "Highly gullible to misinformation and lacks rigorous skepticism"
    ],
    negativeAnchors: [
      "My favorite color is green",
      "I had coffee this morning",
      "The wall is painted white"
    ]
  },
  stressResponse: {
    highAnchors: [
      "Completely shuts down or freezes to inaction during high pressure",
      "Exhibits severe avoidance behaviors when facing conflict or deadlines",
      "Actively spirals into catastrophizing thoughts under stress",
      "Runs away from difficult conversations and difficult problems",
      "Performance collapses entirely when the stakes get high"
    ],
    lowAnchors: [
      "Thrives and focuses sharply under intense pressure or deadlines",
      "Leans directly into conflict to resolve it decisively",
      "Becomes highly organized and systematic when a crisis hits",
      "Performs best when the stakes are highest and time is short",
      "Takes control and manages chaos efficiently without panicking"
    ],
    negativeAnchors: [
      "I took a walk in the park",
      "Cooking pasta for dinner",
      "Today is Tuesday"
    ]
  }
};

const CONCEPT_CACHE_KEY = 'dimension_concept_embeddings_v2'; // Bumped version

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
  
  // Track which text belongs to which dimension and pole
  const keys: Array<{ dim: string; pole: 'high' | 'low' | 'negative' }> = [];

  for (const [dim, anchors] of Object.entries(DIMENSION_CONCEPTS)) {
    for (const text of anchors.highAnchors) {
      allTexts.push(text);
      keys.push({ dim, pole: 'high' });
    }
    for (const text of anchors.lowAnchors) {
      allTexts.push(text);
      keys.push({ dim, pole: 'low' });
    }
    for (const text of anchors.negativeAnchors) {
      allTexts.push(text);
      keys.push({ dim, pole: 'negative' });
    }
  }

  // Batch embed all anchor sentences
  const embeddings = await service.embedBatch(allTexts);

  // Reassemble the embeddings into the nested structure
  for (let i = 0; i < keys.length; i++) {
    const { dim, pole } = keys[i];
    if (!concepts[dim]) {
      concepts[dim] = { high: [], low: [], negative: [] };
    }
    concepts[dim][pole].push(embeddings[i]);
  }

  cachedConcepts = concepts;
  await cacheSet(CONCEPT_CACHE_KEY, concepts, 86400 * 30);
  return concepts;
}
