import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fileSizeLimitMessage, readFileText, type ProjectSummary } from '@collabcode/shared';
import { useProject } from '../../collab/useProject.js';
import { useCollaborators, usePublishIdentity } from '../../collab/useCollaborators.js';
import { remoteOnly } from '../../collab/collaborators.js';
import { useEntryFile } from '../../collab/useEntryFile.js';
import { browserStorage, loadIdentity, saveIdentity, withName } from '../../lib/identity.js';
import { useSlowFlag } from '../../lib/useSlowFlag.js';
import { CodeEditor } from '../editor/CodeEditor.js';
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
  const entryFile = useEntryFile(session);
  usePublishIdentity(session, identity, entryFile?.id ?? null);
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
    () => (session && entryFile ? (readFileText(session.doc, entryFile.id) ?? null) : null),
    [session, entryFile],
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
            <section aria-label="Files" className="h-full">
              {entryFile && (
                <p className="px-3 py-2 font-mono text-xs text-zinc-400">{entryFile.name}</p>
              )}
            </section>
          }
          editor={
            ytext && awareness && entryFile ? (
              <CodeEditor
                ytext={ytext}
                awareness={awareness}
                fileName={entryFile.name}
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
