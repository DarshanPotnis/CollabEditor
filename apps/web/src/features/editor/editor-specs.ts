/**
 * What the model registry should hold, derived from the open tabs and the
 * resolved tree. A live file is editable at its path; a deleted file stays
 * open, read-only, under a URI of its own; a permanently deleted file has no
 * content left and gets no model at all.
 */
import type * as Y from 'yjs';
import type { ResolvedTree } from '@collabcode/shared';
import type { Tab } from '../tabs/tabs-state.js';
import { tabStatus } from '../tabs/tabs-state.js';
import { languageForFileName } from './language.js';
import type { ModelSpec } from './model-registry.js';
import { deletedFileUri, liveFileUri } from './model-uri.js';

export function editorSpecs(
  tabs: readonly Tab[],
  tree: ResolvedTree,
  textFor: (fileId: string) => Y.Text | undefined,
): Map<string, ModelSpec> {
  const specs = new Map<string, ModelSpec>();
  for (const tab of tabs) {
    const ytext = textFor(tab.id);
    if (!ytext) continue;
    const status = tabStatus(tree, tab.id);
    if (status.kind === 'live' && status.node.kind === 'file') {
      specs.set(tab.id, {
        uri: liveFileUri(status.node.path),
        language: languageForFileName(status.node.displayName),
        ytext,
        readOnly: false,
      });
    } else if (status.kind === 'deleted' && status.hidden.kind === 'file') {
      specs.set(tab.id, {
        uri: deletedFileUri(tab.id, status.hidden.name),
        language: languageForFileName(status.hidden.name),
        ytext,
        readOnly: true,
      });
    }
  }
  return specs;
}
