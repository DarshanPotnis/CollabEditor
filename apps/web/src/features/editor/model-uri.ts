/**
 * Monaco model URIs. A live file's URI is its resolved path, so Monaco's
 * TypeScript worker can resolve imports between open files. URIs are built
 * with URI.file, which percent-encodes each path segment, never by string
 * concatenation: a name may contain #, ?, % or spaces, which would otherwise
 * be read as a fragment, a query or an escape.
 *
 * A deleted file moves to its own scheme keyed by id, because a new file can
 * take its old path while its tab is still open, and two models may not share
 * a URI.
 */
import { URI } from 'monaco-editor/base/common/uri';

export const DELETED_SCHEME = 'collabcode-deleted';

export function liveFileUri(path: string): URI {
  return URI.file(`/${path}`);
}

export function deletedFileUri(id: string, name: string): URI {
  return URI.from({ scheme: DELETED_SCHEME, path: `/${id}/${name}` });
}
