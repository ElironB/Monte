import { SignalExtractor } from './base.js';
import { RawSourceData, BehavioralSignal } from '../types.js';
import {
  analyzeTemporalPatterns,
  calculateRecurrence,
  detectTrend,
  scaleConfidence,
} from './temporalUtils.js';

interface ParsedMessage {
  text: string;           // User message content
  timestamp: string;      // ISO 8601 timestamp
  conversationId: string; // Group messages into conversations
  conversationTitle?: string;
  platform: 'chatgpt' | 'claude' | 'gemini' | 'grok';
}

const TOPIC_CATEGORIES: Record<string, { value: string; category: string; base: number; pattern: RegExp }> = {
  finance: {
    value: 'financial_concern',
    category: 'finance',
    base: 0.8,
    pattern: /budget|invest|tax|salary|stock|crypto|debt|mortgage|retire|savings|expense|income|net worth|portfolio/i,
  },
  career: {
    value: 'career_deliberation',
    category: 'career',
    base: 0.75,
    pattern: /career|resume|interview|job|promotion|raise|quit|resign|startup|business plan|side hustle|freelance/i,
  },
  health: {
    value: 'health_concern',
    category: 'health',
    base: 0.7,
    pattern: /symptom|diagnos|medic|doctor|therapy|mental health|anxiety|depress|insomnia|diet|workout|weight/i,
  },
  relationships: {
    value: 'relationship_processing',
    category: 'relationships',
    base: 0.7,
    pattern: /relationship|partner|dating|marriage|divorce|breakup|family|conflict|argument|boundary|trust/i,
  },
  coding: {
    value: 'technical_learning',
    category: 'technology',
    base: 0.65,
    pattern: /code|function|bug|error|api|database|deploy|react|python|typescript|algorithm|debug/i,
  },
  creative: {
    value: 'creative_expression',
    category: 'creative',
    base: 0.6,
    pattern: /write.*story|poem|creative|novel|script|song|art|design|logo|brand/i,
  },
  legal: {
    value: 'legal_concern',
    category: 'legal',
    base: 0.75,
    pattern: /lawyer|legal|contract|lawsuit|copyright|patent|liability|terms|agreement|dispute/i,
  },
  education: {
    value: 'education_pursuit',
    category: 'education',
    base: 0.7,
    pattern: /learn|course|degree|certif|study|exam|tutor|university|college|master|phd/i,
  },
};

const ANXIETY_PATTERN = /worried|anxious|scared|nervous|panic|stress|overwhelm|can't sleep|freaking out|terrified|desperate/i;
const EXCITEMENT_PATTERN = /excited|amazing|can't wait|thrilled|incredible|finally|breakthrough|eureka/i;
const FRUSTRATION_PATTERN = /frustrated|stuck|nothing works|give up|hopeless|annoyed|furious|useless|broken/i;

const DELEGATION_PATTERN = /write (this|it|me|my)|draft (a|my|the)|create (a|my)|generate|make me|do this for me/i;
const COLLABORATION_PATTERN = /help me (think|understand|figure|decide|analyze)|what do you think|pros and cons|should i|advice/i;
const VALIDATION_PATTERN = /is this (good|right|correct|ok)|review (this|my)|check (this|my)|does this (make sense|look right)/i;

export class AIChatHistoryExtractor extends SignalExtractor {
  readonly sourceTypes = ['ai_chat'];

  async extract(data: RawSourceData): Promise<BehavioralSignal[]> {
    const messages = this.parseConversations(data.rawContent);
    if (messages.length === 0) return [];

    const signals: BehavioralSignal[] = [];
    const totalMessages = messages.length;

    // 1. Topic classification signals
    for (const cat of Object.values(TOPIC_CATEGORIES)) {
      const matched = messages.filter(m => cat.pattern.test(m.text));
      if (matched.length === 0) continue;

      const matchedTimestamps = matched.map(m => m.timestamp).filter(Boolean);
      const latestTimestamp = this.getLatestTimestamp(matchedTimestamps);
      const temporal = analyzeTemporalPatterns(matchedTimestamps);
      const recurrence = calculateRecurrence(matched.length, totalMessages);

      const trendPoints = matchedTimestamps.map(ts => ({ timestamp: ts, value: 1 }));
      const trend = detectTrend(trendPoints);

      const confidence = scaleConfidence(matched.length, totalMessages, cat.base);

      signals.push(
        this.createSignal(
          'interest',
          cat.value,
          confidence,
          `${matched.length}/${totalMessages} messages match: ${matched.map(m => m.text.substring(0, 50)).slice(0, 3).join('; ')}`,
          data.sourceId,
          {
            category: cat.category,
            frequency: matched.length,
            recurrence,
            temporalCluster: temporal.dominantCluster,
            intensityTrend: trend,
          },
          latestTimestamp
        )
      );
    }

    // 2. Emotional Tone signals
    const anxietyMatched = messages.filter(m => ANXIETY_PATTERN.test(m.text));
    if (anxietyMatched.length > 0) {
      signals.push(this.createSignal(
        'emotional_state',
        'anxiety',
        scaleConfidence(anxietyMatched.length, totalMessages, 0.8),
        `${anxietyMatched.length} messages show anxiety`,
        data.sourceId,
        { sentiment: 'negative', frequency: anxietyMatched.length },
        this.getLatestTimestamp(anxietyMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    const excitementMatched = messages.filter(m => EXCITEMENT_PATTERN.test(m.text));
    if (excitementMatched.length > 0) {
      signals.push(this.createSignal(
        'emotional_state',
        'excitement',
        scaleConfidence(excitementMatched.length, totalMessages, 0.75),
        `${excitementMatched.length} messages show excitement`,
        data.sourceId,
        { sentiment: 'positive', frequency: excitementMatched.length },
        this.getLatestTimestamp(excitementMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    const frustrationMatched = messages.filter(m => FRUSTRATION_PATTERN.test(m.text));
    if (frustrationMatched.length > 0) {
      signals.push(this.createSignal(
        'emotional_state',
        'frustration',
        scaleConfidence(frustrationMatched.length, totalMessages, 0.8),
        `${frustrationMatched.length} messages show frustration`,
        data.sourceId,
        { sentiment: 'negative', frequency: frustrationMatched.length },
        this.getLatestTimestamp(frustrationMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    // 3. Decision Delegation Pattern
    const delegationMatched = messages.filter(m => DELEGATION_PATTERN.test(m.text));
    if (delegationMatched.length > 0) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'delegation_reliance',
        scaleConfidence(delegationMatched.length, totalMessages, 0.75),
        `${delegationMatched.length} messages asking AI to do work`,
        data.sourceId,
        { frequency: delegationMatched.length },
        this.getLatestTimestamp(delegationMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    const collabMatched = messages.filter(m => COLLABORATION_PATTERN.test(m.text));
    if (collabMatched.length > 0) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'collaborative_thinker',
        scaleConfidence(collabMatched.length, totalMessages, 0.7),
        `${collabMatched.length} messages asking AI to think/decide`,
        data.sourceId,
        { frequency: collabMatched.length },
        this.getLatestTimestamp(collabMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    const valMatched = messages.filter(m => VALIDATION_PATTERN.test(m.text));
    if (valMatched.length > 0) {
      signals.push(this.createSignal(
        'cognitive_trait',
        'validation_seeking',
        scaleConfidence(valMatched.length, totalMessages, 0.8),
        `${valMatched.length} messages asking AI to validate work`,
        data.sourceId,
        { frequency: valMatched.length },
        this.getLatestTimestamp(valMatched.map(m => m.timestamp).filter(Boolean))
      ));
    }

    // 4. Repetition/Revisiting Detection
    for (const cat of Object.values(TOPIC_CATEGORIES)) {
      const matched = messages.filter(m => cat.pattern.test(m.text));
      if (matched.length === 0) continue;
      
      const convs = new Set<string>();
      for (const m of matched) {
         if (m.conversationId) convs.add(m.conversationId);
      }
      
      if (convs.size >= 3) {
        const timestamps = matched.map(m => m.timestamp).filter(Boolean).sort();
        if (timestamps.length >= 2) {
          const first = new Date(timestamps[0]).getTime();
          const last = new Date(timestamps[timestamps.length - 1]).getTime();
          const daysApart = (last - first) / (1000 * 60 * 60 * 24);
          
          if (daysApart > 7 && !isNaN(daysApart)) {
            signals.push(this.createSignal(
               'cognitive_trait',
               `decision_paralysis_${cat.category}`,
               0.85,
               `Revisiting ${cat.category} across ${convs.size} conversations spanning ${daysApart.toFixed(1)} days`,
               data.sourceId,
               {
                 category: cat.category,
                 frequency: matched.length,
                 recurrence: calculateRecurrence(matched.length, totalMessages),
               },
               this.getLatestTimestamp(timestamps)
            ));
          }
        }
      }
    }

    // 5. Prompting Style
    let totalWordCount = 0;
    let structuredCount = 0;
    let shortCount = 0;
    let constraintsCount = 0;

    for (const m of messages) {
       const words = m.text.trim().split(/\s+/).length;
       totalWordCount += words;
       
       if (/^[-*] |\d+\./m.test(m.text)) structuredCount++;
       if (words > 0 && words < 25) shortCount++; // "1-2 sentences"
       if (/(must|don't|do not|require|exactly|limit|only|max|min)/i.test(m.text)) constraintsCount++;
    }

    const avgWords = totalWordCount / (totalMessages || 1);
    
    if (structuredCount > totalMessages * 0.3) {
      signals.push(this.createSignal(
         'cognitive_trait',
         'structured_thinker',
         0.7,
         `${structuredCount}/${totalMessages} messages use structured formatting`,
         data.sourceId,
         { frequency: structuredCount }
      ));
    }

    if (shortCount > totalMessages * 0.6) {
      signals.push(this.createSignal(
         'cognitive_trait',
         'intuitive_communicator',
         0.65,
         `Mostly short, direct messages (avg ${avgWords.toFixed(1)} words)`,
         data.sourceId,
         { frequency: shortCount }
      ));
    }

    if (constraintsCount > totalMessages * 0.2) {
      signals.push(this.createSignal(
         'cognitive_trait',
         'systematic_planner',
         0.75,
         `${constraintsCount}/${totalMessages} messages have explicit constraints`,
         data.sourceId,
         { frequency: constraintsCount }
      ));
    }

    return signals;
  }

  private parseConversations(raw: string): ParsedMessage[] {
    const messages: ParsedMessage[] = [];
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return messages;
    }

    // ChatGPT detection and parsing
    if (Array.isArray(parsed) && parsed[0]?.mapping) {
      for (const conv of parsed) {
        const convId = conv.id || conv.conversation_id || '';
        const convTitle = conv.title || '';
        for (const node of Object.values(conv.mapping)) {
          const msg = (node as any).message;
          if (!msg || msg.author?.role !== 'user') continue;
          const parts = msg.content?.parts || [];
          const text = parts.filter((p: any) => typeof p === 'string').join('\n').trim();
          if (!text) continue;
          messages.push({
            text,
            timestamp: msg.create_time ? new Date(Math.floor(Number(msg.create_time) * 1000)).toISOString() : '',
            conversationId: convId,
            conversationTitle: convTitle,
            platform: 'chatgpt',
          });
        }
      }
      if (messages.length > 0) return messages;
    }

    // Claude detection
    if (Array.isArray(parsed) && parsed[0]?.chat_messages) {
      for (const conv of parsed) {
        for (const msg of conv.chat_messages || []) {
          if (msg.sender !== 'human') continue;
          messages.push({
            text: msg.text || '',
            timestamp: msg.created_at || conv.created_at || '',
            conversationId: conv.uuid || '',
            conversationTitle: conv.name || '',
            platform: 'claude',
          });
        }
      }
      if (messages.length > 0) return messages;
    }

    // Gemini detection
    if (Array.isArray(parsed) && parsed[0]?.activityControls) {
      for (const entry of parsed) {
        const products = entry.products || [];
        if (!products.some((p: string) => /gemini/i.test(p))) continue;
        let text = entry.title || '';
        text = text.replace(/^(Used Gemini Apps?\s*[-–—:]?\s*)/i, '').trim();
        if (!text || text.length < 5) continue;
        messages.push({
          text,
          timestamp: entry.time || '',
          conversationId: entry.titleUrl || '',  
          conversationTitle: '',
          platform: 'gemini',
        });
      }
      if (messages.length > 0) return messages;
    }

    // Grok detection
    const items = parsed.conversations || parsed.messages || parsed.chats || (Array.isArray(parsed) ? parsed : []);
    for (const item of items) {
      const msgs = item.messages || [item];
      for (const msg of msgs) {
        const role = msg.role || msg.sender || msg.author || '';
        if (role === 'assistant' || role === 'grok' || role === 'system') continue;
        messages.push({
          text: msg.content || msg.text || msg.body || '',
          timestamp: msg.timestamp || msg.created_at || msg.time || item.created_at || '',
          conversationId: item.id || item.conversation_id || '',
          conversationTitle: item.title || item.name || '',
          platform: 'grok',
        });
      }
    }

    return messages;
  }
}
