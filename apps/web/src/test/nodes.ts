/** Test fixture: node fields with defaults, for building trees in tests. */
import type { NodeFields } from '@collabcode/shared';

export function node(overrides: Partial<NodeFields> & Pick<NodeFields, 'id' | 'name'>): NodeFields {
  return {
    kind: 'file',
    parentId: null,
    createdAt: 1,
    createdBy: 'u',
    deletedAt: null,
    deletedBy: null,
    deletedByName: null,
    ...overrides,
  };
}
