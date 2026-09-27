/** A starter project as a plain file map. Nothing here knows about Yjs. */

export type TemplateFile = {
  /** Slash-separated path from the project root; folders are implied. */
  path: string;
  content: string;
};

export const TEMPLATE_IDS = ['express-api', 'blank-node'] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type Template = {
  id: TemplateId;
  label: string;
  description: string;
  files: readonly [TemplateFile, ...TemplateFile[]];
  /** The file a visitor opens first. Must be one of `files`. */
  entryPath: string;
};
