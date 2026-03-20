// Raw data types from all ingestion sources
export interface RawSourceData {
  sourceId: string;
  userId: string;
  sourceType: 'search_history' | 'watch_history' | 'social_media' | 'financial' | 'notes' | 'files' | 'composio';
  rawContent: string;
  metadata: {
    timestamp?: string;
    url?: string;
    title?: string;
    platform?: string;
    fileType?: string;
    fileName?: string;
  };
  mediaUrls?: string[]; // For images/docs
}

// Extracted behavioral signals
export interface BehavioralSignal {
  id: string;
  type: 'search_intent' | 'interest' | 'financial_behavior' | 'social_pattern' | 'cognitive_trait' | 'emotional_state';
  value: string;
  confidence: number; // 0-1
  evidence: string;
  sourceDataId: string;
  timestamp: string;
  dimensions: {
    category?: string;
    sentiment?: 'positive' | 'negative' | 'neutral';
    urgency?: number; // 0-1
    recurrence?: number; // how often this appears
    frequency?: number; // raw count of pattern matches
    temporalCluster?: string; // e.g., 'late_night', 'morning', 'weekend', 'weekday'
    intensityTrend?: 'increasing' | 'decreasing' | 'stable';
    coOccurrence?: string[];
  };
}

// Contradiction between signals
export interface SignalContradiction {
  id: string;
  signalAId: string;
  signalBId: string;
  type: 'stated_vs_revealed' | 'temporal' | 'cross_domain';
  description: string;
  severity: 'low' | 'medium' | 'high';
  magnitude: number;
  affectedDimensions: string[];
  resolution?: string;
}
