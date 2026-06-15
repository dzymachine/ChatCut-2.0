/**
 * Recipe template search + learned cache.
 *
 * Seeds ship in src-shared/recipe-templates.json; successful composes/appends
 * are appended to <app-data>/recipe-cache.json (with the user's originating
 * prompt as the description) so good looks become searchable next session.
 */

import templatesJson from '../../../src-shared/recipe-templates.json';
import type { Recipe } from '../../../src-shared/recipe';
import { isTauri } from '@/lib/tauri/bridge';

export interface RecipeTemplate {
  id: string;
  name: string;
  tags: string[];
  description: string;
  recipe: Recipe;
  /** True for entries learned from this user's sessions. */
  learned?: boolean;
}

const CACHE_FILE = 'recipe-cache.json';
const MAX_CACHE_ENTRIES = 100;

export function getSeedTemplates(): RecipeTemplate[] {
  return (templatesJson as { templates: RecipeTemplate[] }).templates;
}

export async function readLearnedTemplates(): Promise<RecipeTemplate[]> {
  if (!isTauri()) return [];
  try {
    const { readTextFile, exists, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    if (!(await exists(CACHE_FILE, { baseDir: BaseDirectory.AppData }))) return [];
    const raw = await readTextFile(CACHE_FILE, { baseDir: BaseDirectory.AppData });
    const parsed = JSON.parse(raw) as { templates?: RecipeTemplate[] };
    return (parsed.templates ?? []).map((t) => ({ ...t, learned: true }));
  } catch (err) {
    console.warn('[template-cache] read failed:', err);
    return [];
  }
}

/** Fire-and-forget append of a successful look to the learned cache. */
export async function appendLearnedTemplate(entry: {
  name: string;
  prompt: string;
  recipe: Recipe;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    const existing = await readLearnedTemplates();
    const next: RecipeTemplate = {
      id: `learned-${Date.now()}`,
      name: entry.name,
      tags: entry.prompt.toLowerCase().split(/\W+/).filter((w) => w.length > 2),
      description: entry.prompt,
      recipe: entry.recipe,
      learned: true,
    };
    const templates = [...existing, next].slice(-MAX_CACHE_ENTRIES);
    const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(CACHE_FILE, JSON.stringify({ templates }, null, 2), {
      baseDir: BaseDirectory.AppData,
    });
  } catch (err) {
    console.warn('[template-cache] write failed:', err);
  }
}

/**
 * Fuzzy-search seeds ∪ learned cache. Token-overlap scoring over
 * name/tags/description — cheap and good enough for ~100 entries.
 */
export async function searchTemplates(query: string, limit = 5): Promise<RecipeTemplate[]> {
  const tokens = query.toLowerCase().split(/\W+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const all = [...getSeedTemplates(), ...(await readLearnedTemplates())];

  const scored = all.map((t) => {
    const haystackName = t.name.toLowerCase();
    const haystackTags = t.tags.map((x) => x.toLowerCase());
    const haystackDesc = t.description.toLowerCase();
    let score = 0;
    for (const tok of tokens) {
      if (haystackName.includes(tok)) score += 3;
      if (haystackTags.some((tag) => tag.includes(tok))) score += 2;
      if (haystackDesc.includes(tok)) score += 1;
    }
    return { t, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.t);
}
