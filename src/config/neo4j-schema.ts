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
  'CREATE CONSTRAINT sourcefile_id IF NOT EXISTS FOR (f:SourceFile) REQUIRE f.id IS UNIQUE',
  'CREATE CONSTRAINT contradiction_id IF NOT EXISTS FOR (c:Contradiction) REQUIRE c.id IS UNIQUE',
  'CREATE CONSTRAINT apikey_id IF NOT EXISTS FOR (k:ApiKey) REQUIRE k.id IS UNIQUE',
  'CREATE CONSTRAINT apikey_prefix IF NOT EXISTS FOR (k:ApiKey) REQUIRE k.keyPrefix IS UNIQUE',
];

const INDEXES = [
  'CREATE INDEX simulation_status IF NOT EXISTS FOR (s:Simulation) ON (s.status)',
  'CREATE INDEX simulation_created IF NOT EXISTS FOR (s:Simulation) ON (s.createdAt)',
  'CREATE INDEX clone_category IF NOT EXISTS FOR (c:Clone) ON (c.category)',
  'CREATE INDEX datasource_status IF NOT EXISTS FOR (d:DataSource) ON (d.status)',
  'CREATE INDEX sourcefile_status IF NOT EXISTS FOR (f:SourceFile) ON (f.status)',
  'CREATE INDEX trait_name IF NOT EXISTS FOR (t:Trait) ON (t.name)',
];

const VECTOR_INDEX = "CREATE VECTOR INDEX signal_embedding IF NOT EXISTS FOR (s:Signal) ON (s.embedding) OPTIONS {indexConfig: {`vector.dimensions`: 1536, `vector.similarity_function`: 'cosine'}}";

export async function initializeSchema(): Promise<void> {
  logger.info('Initializing Neo4j schema...');

  // Create constraints
  for (const constraint of CONSTRAINTS) {
    try {
      await runWrite(constraint);
      logger.debug({ constraint: constraint.split(' ')[2] }, 'Constraint created');
    } catch (err) {
      logger.debug({ constraint: constraint.split(' ')[2] }, 'Constraint creation skipped');
    }
  }

  for (const index of INDEXES) {
    try {
      await runWrite(index);
      logger.debug({ index: index.split(' ')[2] }, 'Index created');
    } catch (err) {
      logger.debug({ index: index.split(' ')[2] }, 'Index creation skipped');
    }
  }

  try {
    const driver = await getNeo4jDriver();
    const session = driver.session();
    try {
      await session.run(VECTOR_INDEX);
      logger.debug({ index: 'signal_embedding' }, 'Vector index created');
    } finally {
      await session.close();
    }
  } catch (err) {
    logger.warn({ err, index: 'signal_embedding' }, 'Vector index creation skipped');
  }

  logger.info('Neo4j schema ready');
}
