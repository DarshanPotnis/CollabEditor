import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fileSizeLimitMessage,
  readFileText,
  readMeta,
  type ProjectSummary,
} from '@collabcode/shared';
import { useProject } from '../../collab/useProject.js';
import { useCollaborators, usePublishIdentity } from '../../collab/useCollaborators.js';
import { remoteOnly } from '../../collab/collaborators.js';
import { entryFileId } from '../../collab/entry-file.js';
import { useFilePresence } from '../../collab/useFilePresence.js';
import { useResolvedTree } from '../../collab/useResolvedTree.js';
import { browserStorage, loadIdentity, saveIdentity, withName } from '../../lib/identity.js';
import { useSlowFlag } from '../../lib/useSlowFlag.js';
import { CodeEditor } from '../editor/CodeEditor.js';
import { FileTree } from '../file-tree/FileTree.js';
import { useExpandedFolders } from '../file-tree/useExpandedFolders.js';
import { useRemoteCursorStyles } from '../editor/useRemoteCursorStyles.js';
import { ConnectionBanner } from '../status/ConnectionBanner.js';
import { RunPanelPlaceholder } from '../runtime/RunPanelPlaceholder.js';
import { NotFoundPage } from './NotFoundPage.js';
import { useProjectSummary } from './useProjectSummary.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';
import { WorkspaceLayout } from './WorkspaceLayout.js';

const COLD_START_AFTER_MS = 2_000;

function Workspace({ project }: { project: ProjectSummary }): React.ReactElement {
  const { session, connection } = useProject(project.id);
  const [identity, setIdentity] = useState(() => loadIdentity(browserStorage()));
  const [notice, setNotice] = useState<string | null>(null);

  const collaborators = useCollaborators(session);
  const tree = useResolvedTree(session);
  const presence = useFilePresence(collaborators);
  const folders = useExpandedFolders(project.id);
  const [openedFileId, setOpenedFileId] = useState<string | null>(null);

  // Until someone picks a file, show the template's entry file.
  const activeFileId =
    openedFileId !== null && tree.byId.has(openedFileId)
      ? openedFileId
      : session
        ? entryFileId(tree, readMeta(session.doc))
        : null;
  const activeFile = activeFileId === null ? undefined : tree.byId.get(activeFileId);

  usePublishIdentity(session, identity, activeFileId);
  useRemoteCursorStyles(remoteOnly(collaborators));

  const rename = useCallback((name: string) => {
    setIdentity((current) => {
      const next = withName(current, name);
      saveIdentity(browserStorage(), next);
      return next;
    });
  }, []);

  const onFileSizeLimit = useCallback(() => setNotice(fileSizeLimitMessage()), []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 6_000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  const ytext = useMemo(
    () => (session && activeFileId ? (readFileText(session.doc, activeFileId) ?? null) : null),
    [session, activeFileId],
  );
  const awareness = session?.provider.awareness ?? null;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        projectName={project.name}
        collaborators={collaborators}
        identity={identity}
        onRename={rename}
      />

      <ConnectionBanner state={connection} />

      {notice && (
        <p
          role="alert"
          className="border-b border-amber-900 bg-amber-950/60 px-4 py-2 text-sm text-amber-100"
        >
          {notice}
        </p>
      )}

      <main className="min-h-0 flex-1">
        <WorkspaceLayout
          tree={
            <FileTree
              tree={tree}
              folders={folders}
              activeFileId={activeFileId}
              presence={presence}
              onOpenFile={setOpenedFileId}
            />
          }
          editor={
            ytext && awareness && activeFile ? (
              <CodeEditor
                ytext={ytext}
                awareness={awareness}
                fileName={activeFile.path}
                onFileSizeLimit={onFileSizeLimit}
              />
            ) : (
              <p className="p-4 text-sm text-zinc-400">Loading the project…</p>
            )
          }
          run={<RunPanelPlaceholder />}
        />
      </main>
    </div>
  );
}

export function WorkspacePage(): React.ReactElement {
  const { projectId = '' } = useParams();
  const summary = useProjectSummary(projectId);
  const slow = useSlowFlag(summary.status === 'loading', COLD_START_AFTER_MS);

  if (summary.status === 'missing') return <NotFoundPage />;

  if (summary.status === 'error') {
    return (
      <main className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-md">
          <h1 className="text-xl font-semibold">Could not open this project</h1>
          <p className="mt-2 text-sm text-zinc-400">{summary.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-5 rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (summary.status === 'loading') {
    return (
      <main className="flex h-full items-center justify-center p-6 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-zinc-300">
            {slow ? 'Waking up the server…' : 'Opening the project…'}
          </p>
          {slow && (
            <p className="mt-2 text-sm text-zinc-500">
              The free server sleeps when nobody is using it, so this can take up to a minute.
            </p>
          )}
        </div>
      </main>
    );
  }

  return <Workspace project={summary.project} />;
}
