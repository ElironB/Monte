import { getNeo4jDriver, runWrite } from './neo4j.js';
import { logger } from '../utils/logger.js';

const CONSTRAINTS = [
  'CREATE CONSTRAINT user_id IF NOT EXISTS FOR (u:User) REQUIRE u.id IS UNIQUE',
  'CREATE CONSTRAINT user_email IF NOT EXISTS FOR (u:User) REQUIRE u.email IS UNIQUE',
  'CREATE CONSTRAINT persona_id IF NOT EXISTS FOR (p:Persona) REQUIRE p.id IS UNIQUE',
  'CREATE CONSTRAINT trait_id IF NOT EXISTS FOR (t:Trait) REQUIRE t.id IS UNIQUE',
  'CREATE CONSTRAINT memory_id IF NOT EXISTS FOR (m:Memory) REQUIRE m.id IS UNIQUE',
  'CREATE CONSTRAINT clone_id IF NOT EXISTS FOR (c:Clone) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT simulation_id IF NOT EXISTS FOR (s:Simulation) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT signal_id IF NOT EXISTS FOR (s:Signal) REQUIRE s.id IS UNIQUE',
  'CREATE CONSTRAINT contradiction_id IF NOT EXISTS FOR (c:Contradiction) REQUIRE c.id IS UNIQUE',
];

export async function initializeSchema(): Promise<void> {
  logger.info('Initializing Neo4j schema...');
  for (const constraint of CONSTRAINTS) {
    try {
      await runWrite(constraint);
    } catch (err) {
      logger.debug({ constraint }, 'Constraint creation skipped');
    }
  }
  logger.info('Neo4j schema ready');
}
