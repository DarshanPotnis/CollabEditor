/**
 * Where a collaborator's cursor is, from the `selection` field y-monaco keeps
 * in their awareness state: Yjs relative positions, which reach us as JSON.
 * Like everything in a remote awareness state it is untrusted, so it is
 * parsed before it touches the document.
 */
import * as Y from 'yjs';
import { z } from 'zod';

const MAX_ID = Number.MAX_SAFE_INTEGER;

const idSchema = z.object({
  client: z.number().int().nonnegative().max(MAX_ID),
  clock: z.number().int().nonnegative().max(MAX_ID),
});

/**
 * A position inside a file's Y.Text: an `item` id, or the `type` id for the
 * end of an empty text. `tname` (a root type by name) is refused: file
 * contents are never root types, and resolving one makes Yjs call
 * `doc.get(tname)`, which would let a peer create root types in our document.
 * A position with none of the three makes Yjs throw, so it is refused too.
 */
const relativePositionSchema = z
  .object({
    type: idSchema.nullable().optional(),
    tname: z.null().optional(),
    item: idSchema.nullable().optional(),
    assoc: z.number().int().min(-1).max(0).optional(),
  })
  .refine((position) => Boolean(position.item) || Boolean(position.type), {
    message: 'a position needs an item or a type',
  });

const stateSchema = z.object({
  selection: z.object({ anchor: relativePositionSchema, head: relativePositionSchema }),
});

/**
 * The index of the collaborator's cursor (their selection's head) in `ytext`,
 * or null when they have no selection, it is malformed, or it points into a
 * different file.
 */
export function remoteCursorIndex(rawState: unknown, ytext: Y.Text): number | null {
  const doc = ytext.doc;
  const parsed = stateSchema.safeParse(rawState);
  if (!doc || !parsed.success) return null;
  const head = Y.createRelativePositionFromJSON(parsed.data.selection.head);
  const absolute = Y.createAbsolutePositionFromRelativePosition(head, doc);
  return absolute?.type === ytext ? absolute.index : null;
}
