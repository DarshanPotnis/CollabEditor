/**
 * Which Monaco models to dispose and create, given the models that exist and
 * the ones the open tabs need, each keyed by file id and identified by URI
 * string. A file whose URI changed (renamed, moved, deleted, restored) is in
 * both lists: Monaco URIs are immutable, so it gets a new model.
 *
 * Every disposal happens before any creation, so two files that swap paths
 * never try to hold the same URI at once.
 */
export type ModelPlan = { dispose: string[]; create: string[] };

export function planModels(
  current: ReadonlyMap<string, string>,
  desired: ReadonlyMap<string, string>,
): ModelPlan {
  const dispose: string[] = [];
  const create: string[] = [];
  for (const [id, key] of current) {
    if (desired.get(id) !== key) dispose.push(id);
  }
  for (const [id, key] of desired) {
    if (current.get(id) !== key) create.push(id);
  }
  return { dispose, create };
}
