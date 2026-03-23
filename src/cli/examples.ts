import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

export interface BundledExamplePersona {
  id: string;
  name: string;
  description: string;
  relativePath: string;
  recommendedQuestion: string;
  recommendedScenario: string;
}

const EXAMPLE_PERSONAS: BundledExamplePersona[] = [
  {
    id: 'starter',
    name: 'Starter Persona',
    description: 'Product-minded engineer balancing ambition, savings discipline, and startup curiosity.',
    relativePath: 'examples/personas/starter',
    recommendedQuestion: 'should I leave my stable product job to join a startup and put $25k into the idea?',
    recommendedScenario: 'startup_founding',
  },
];

function getPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function listBundledExamplePersonas(): BundledExamplePersona[] {
  return EXAMPLE_PERSONAS.slice();
}

export function getBundledExamplePersona(id: string = 'starter'): BundledExamplePersona {
  const match = EXAMPLE_PERSONAS.find((entry) => entry.id === id);

  if (!match) {
    throw new Error(`Unknown example persona: ${id}`);
  }

  return match;
}

export function getBundledExamplePersonaPath(id: string = 'starter'): string {
  const example = getBundledExamplePersona(id);
  return resolve(getPackageRoot(), example.relativePath);
}

export function assertBundledExamplePersonaExists(id: string = 'starter'): string {
  const path = getBundledExamplePersonaPath(id);

  if (!existsSync(path)) {
    throw new Error(`Bundled example persona is missing from this install: ${path}`);
  }

  return path;
}
