import { runWrite, runWriteSingle, runQuerySingle } from '../config/neo4j.js';
import { BehavioralDimensions } from './dimensionMapper.js';
import { v4 as uuidv4 } from 'uuid';

export interface TraitNode {
  id: string;
  type: string;
  name: string;
  value: number;
  confidence: number;
  evidence: string;
  dimension: keyof BehavioralDimensions;
}

export interface MemoryNode {
  id: string;
  type: string;
  content: string;
  timestamp: string;
  sourceId: string;
  emotionalValence?: number; // -1 to 1
}

export class GraphBuilder {
  private userId: string;
  private personaId: string;

  constructor(userId: string, personaId: string) {
    this.userId = userId;
    this.personaId = personaId;
  }

  async buildPersonaGraph(dimensions: BehavioralDimensions, signalIds: string[]): Promise<void> {
    // Create dimension nodes as traits
    const traits: TraitNode[] = Object.entries(dimensions).map(([dimension, value]) => ({
      id: uuidv4(),
      type: 'dimension',
      name: dimension,
      value,
      confidence: 0.7 + (Math.abs(value - 0.5) * 0.6), // Higher confidence for extreme values
      evidence: `Aggregated from ${signalIds.length} signals`,
      dimension: dimension as keyof BehavioralDimensions,
    }));

    // Store traits in Neo4j
    for (const trait of traits) {
      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId})
         CREATE (t:Trait {
           id: $traitId,
           type: $type,
           name: $name,
           value: $value,
           confidence: $confidence,
           evidence: $evidence,
           dimension: $dimension,
           createdAt: datetime()
         })
         CREATE (p)-[:HAS_TRAIT]->(t)
         RETURN t.id as id`,
        {
          personaId: this.personaId,
          traitId: trait.id,
          type: trait.type,
          name: trait.name,
          value: trait.value,
          confidence: trait.confidence,
          evidence: trait.evidence,
          dimension: trait.dimension,
        }
      );
    }

    // Link signals to persona (they're already stored from ingestion)
    for (const signalId of signalIds) {
      await runWriteSingle(
        `MATCH (p:Persona {id: $personaId}), (s:Signal {id: $signalId})
         CREATE (p)-[:DERIVED_FROM]->(s)
         RETURN p.id as id`,
        { personaId: this.personaId, signalId }
      );
    }

    // Create relationships between related traits
    await this.createTraitRelationships();
  }

  async addMemory(memory: MemoryNode): Promise<void> {
    await runWriteSingle(
      `MATCH (p:Persona {id: $personaId})
       CREATE (m:Memory {
         id: $memoryId,
         type: $type,
         content: $content,
         timestamp: datetime($timestamp),
         sourceId: $sourceId,
         emotionalValence: $emotionalValence,
         createdAt: datetime()
       })
       CREATE (p)-[:HAS_MEMORY]->(m)
       RETURN m.id as id`,
      {
        personaId: this.personaId,
        memoryId: memory.id,
        type: memory.type,
        content: memory.content,
        timestamp: memory.timestamp,
        sourceId: memory.sourceId,
        emotionalValence: memory.emotionalValence ?? 0,
      }
    );
  }

  async getPersonaGraph(): Promise<{ traits: TraitNode[]; memories: MemoryNode[] }> {
    const traits = await this.queryTraits();
    const memories = await this.queryMemories();
    return { traits, memories };
  }

  private async createTraitRelationships(): Promise<void> {
    // Risk tolerance and emotional volatility often correlate
    await runWriteSingle(
      `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t1:Trait {name: 'riskTolerance'}),
               (p)-[:HAS_TRAIT]->(t2:Trait {name: 'emotionalVolatility'})
       WHERE abs(t1.value - 0.5) > 0.3 AND abs(t2.value - 0.5) > 0.3
       CREATE (t1)-[:CORRELATES_WITH {strength: abs(t1.value - t2.value)}]->(t2)
       RETURN t1.id as id`,
      { personaId: this.personaId }
    );

    // Decision speed and time preference
    await runWriteSingle(
      `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t1:Trait {name: 'decisionSpeed'}),
               (p)-[:HAS_TRAIT]->(t2:Trait {name: 'timePreference'})
       WHERE t1.value > 0.7 AND t2.value < 0.3
       CREATE (t1)-[:CONTRADICTS {severity: 'high'}]->(t2)
       RETURN t1.id as id`,
      { personaId: this.personaId }
    );
  }

  private async queryTraits(): Promise<TraitNode[]> {
    const results = await runWrite<TraitNode[]>(
      `MATCH (p:Persona {id: $personaId})-[:HAS_TRAIT]->(t:Trait)
       RETURN t.id as id, t.type as type, t.name as name, 
              t.value as value, t.confidence as confidence, t.evidence as evidence, t.dimension as dimension`,
      { personaId: this.personaId }
    );
    return results[0] ?? [];
  }

  private async queryMemories(): Promise<MemoryNode[]> {
    const results = await runWrite<MemoryNode[]>(
      `MATCH (p:Persona {id: $personaId})-[:HAS_MEMORY]->(m:Memory)
       RETURN m.id as id, m.type as type, m.content as content,
              m.timestamp as timestamp, m.sourceId as sourceId, m.emotionalValence as emotionalValence
       ORDER BY m.timestamp DESC LIMIT 100`,
      { personaId: this.personaId }
    );
    return results[0] ?? [];
  }
}
