import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const AGENTS_DIR = path.join(here, 'agents');
export const SKILLS_DIR = path.join(here, 'skills');
export const KNOWLEDGE_DIR = path.join(here, 'knowledge');
export const PIPELINES_DIR = path.join(here, 'pipelines');
export const PACK_ROOT = here;
