import { useCallback, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  fileSizeLimitMessage,
  readFileText,
  readMeta,
  type ProjectSummary,
} from '@collabcode/shared';
import { useProject } from '../../collab/useProject.js';
import { useCollaborators, usePublishIdentity } from '../../collab/useCollaborators.js';
import { remoteOnly, type Collaborator } from '../../collab/collaborators.js';
import { followLabel, followTarget } from '../../collab/follow.js';
import { remoteCursorIndex } from '../../collab/remote-selection.js';
import { entryFileId } from '../../collab/entry-file.js';
import { useCycleNotice } from '../../collab/useCycleNotice.js';
import { useFilePresence } from '../../collab/useFilePresence.js';
import { useLastEditPresence } from '../../collab/useLastEditPresence.js';
import { useResolvedTree } from '../../collab/useResolvedTree.js';
import { browserStorage, loadIdentity, saveIdentity, withName } from '../../lib/identity.js';
import { useSlowFlag } from '../../lib/useSlowFlag.js';
import type { CodeEditorHandle, RevealRequest } from '../editor/CodeEditor.js';
import { editorSpecs } from '../editor/editor-specs.js';
import type { ModelSpec } from '../editor/model-registry.js';
import { FilesPane, type FilesView } from '../file-tree/FilesPane.js';
import { useTreeActions } from '../file-tree/useTreeActions.js';
import { ToastProvider, useToasts } from '../notifications/ToastProvider.js';
import { useExpandedFolders } from '../file-tree/useExpandedFolders.js';
import { useRemoteCursorStyles } from '../editor/useRemoteCursorStyles.js';
import { AiDiffView } from '../ai/AiDiffView.js';
import { AiPanel } from '../ai/AiPanel.js';
import { describeStep } from '../ai/ai-messages.js';
import { EditInstructionDialog } from '../ai/EditInstructionDialog.js';
import { projectFiles } from '../ai/project-files.js';
import { useAiActions } from '../ai/useAiActions.js';
import { useAiRequest } from '../ai/useAiRequest.js';
import { ConnectionBanner } from '../status/ConnectionBanner.js';
import { RunPanel } from '../runtime/RunPanel.js';
import { useRuntime } from '../runtime/useRuntime.js';
import { useAgentSession } from '../agent/useAgentSession.js';
import { useFollowAgent } from '../agent/useFollowAgent.js';
import { EditorPane } from '../tabs/EditorPane.js';
import { useTabs } from '../tabs/useTabs.js';
import { NotFoundPage } from './NotFoundPage.js';
import { SidePanel } from './SidePanel.js';
import { useProjectSummary } from './useProjectSummary.js';
import { WorkspaceHeader } from './WorkspaceHeader.js';
import { WorkspaceLayout } from './WorkspaceLayout.js';

const COLD_START_AFTER_MS = 2_000;

function Workspace({ project }: { project: ProjectSummary }): React.ReactElement {
  const { session, connection } = useProject(project.id);
  const [identity, setIdentity] = useState(() => loadIdentity(browserStorage()));
  const toasts = useToasts();
  const [filesView, setFilesView] = useState<FilesView>('files');
  const aiRequest = useAiRequest();

  const collaborators = useCollaborators(session);
  const tree = useResolvedTree(session);
  const presence = useFilePresence(collaborators);
  const folders = useExpandedFolders(project.id);
  const entryId = session ? entryFileId(tree, readMeta(session.doc)) : null;
  const tabs = useTabs(tree, entryId);
  const activeId = tabs.state.activeId;

  usePublishIdentity(session, identity, activeId);
  useLastEditPresence(session);
  useRemoteCursorStyles(remoteOnly(collaborators));
  useCycleNotice(tree, toasts);

  const rename = useCallback((name: string) => {
    setIdentity((current) => {
      const next = withName(current, name);
      saveIdentity(browserStorage(), next);
      return next;
    });
  }, []);

  const onFileSizeLimit = useCallback(
    () => toasts.show({ message: fileSizeLimitMessage(), tone: 'error' }),
    [toasts],
  );
  const showError = useCallback(
    (message: string) => toasts.show({ message, tone: 'error' }),
    [toasts],
  );
  const showDeleted = useCallback(() => setFilesView('deleted'), []);
  const runtime = useRuntime(session, showError);
  const agentHost = useMemo(
    () => ({ userId: identity.id, name: identity.name }),
    [identity.id, identity.name],
  );
  const agent = useAgentSession({ projectId: project.id, session, host: agentHost, runtime });
  const actions = useTreeActions(session, identity, toasts, {
    onCreatedFile: tabs.open,
    onShowDeleted: showDeleted,
  });

  const [reveal, setReveal] = useState<RevealRequest | null>(null);
  const revealGently = useCallback(
    (fileId: string, index: number) =>
      setReveal({ fileId, index, requestId: Date.now(), gentle: true }),
    [],
  );
  const openTabs = tabs.state.tabs;
  const isOpen = useCallback((id: string) => openTabs.some((tab) => tab.id === id), [openTabs]);
  const followAgent = useFollowAgent({
    session,
    agentClientId: agent.state.phase === 'running' ? agent.state.agentClientId : null,
    shownFileId: activeId,
    tree,
    isOpen,
    openFile: tabs.open,
    closeFile: tabs.close,
    reveal: revealGently,
  });
  const describeCollaborator = useCallback(
    (collaborator: Collaborator) => followLabel(collaborator, tree, collaborators),
    [tree, collaborators],
  );
  const follow = useCallback(
    (collaborator: Collaborator) => {
      const target = followTarget(collaborator, tree);
      if (target.kind === 'nowhere') {
        toasts.show({ message: target.message, tone: 'info' });
        return;
      }
      tabs.open(target.fileId);
      const ytext = session ? readFileText(session.doc, target.fileId) : undefined;
      const state = session?.provider.awareness?.getStates().get(collaborator.clientId);
      const index = ytext ? remoteCursorIndex(state, ytext) : null;
      if (index !== null) setReveal({ fileId: target.fileId, index, requestId: Date.now() });
    },
    [session, tree, tabs, toasts],
  );

  const specs = useMemo(
    () =>
      session
        ? editorSpecs(tabs.state.tabs, tree, (id) => readFileText(session.doc, id))
        : new Map<string, ModelSpec>(),
    [session, tabs.state.tabs, tree],
  );
  const awareness = session?.provider.awareness ?? null;

  const editorRef = useRef<CodeEditorHandle>(null);
  const notify = useCallback(
    (message: string, tone: 'info' | 'error') => toasts.show({ message, tone }),
    [toasts],
  );
  const files = useCallback(
    () => (session ? projectFiles(tree, session.doc) : null),
    [session, tree],
  );
  const ai = useAiActions({
    projectId: project.id,
    request: aiRequest,
    editor: editorRef,
    openFile: tabs.open,
    notify,
    files,
  });
  const { proposal } = ai;
  const editOverlay =
    proposal.kind === 'ready' && proposal.target.fileId === activeId ? (
      <AiDiffView
        title={describeStep(proposal.target.step)}
        original={proposal.target.anchor.original}
        replacement={proposal.replacement}
        language={proposal.target.language}
        startLine={proposal.target.startLine}
        error={ai.applyError}
        onApply={ai.applyEdit}
        onDiscard={ai.discardEdit}
      />
    ) : null;

  return (
    <div className="flex h-full flex-col">
      <WorkspaceHeader
        projectName={project.name}
        collaborators={collaborators}
        describeCollaborator={describeCollaborator}
        onFollow={follow}
        identity={identity}
        onRename={rename}
      />

      <ConnectionBanner state={connection} />

      <main className="min-h-0 flex-1">
        <WorkspaceLayout
          tree={
            <FilesPane
              tree={tree}
              folders={folders}
              activeFileId={activeId}
              presence={presence}
              actions={actions}
              myUserId={identity.id}
              view={filesView}
              onViewChange={setFilesView}
              onOpenFile={tabs.open}
              onError={showError}
            />
          }
          editor={
            awareness ? (
              <EditorPane
                tree={tree}
                tabs={tabs}
                specs={specs}
                awareness={awareness}
                reveal={reveal}
                myUserId={identity.id}
                onRestore={actions.restore}
                onFileSizeLimit={onFileSizeLimit}
                onAiAction={ai.onEditorAction}
                editorRef={editorRef}
                overlay={editOverlay}
              />
            ) : (
              <p className="p-4 text-sm text-zinc-400">Loading the project…</p>
            )
          }
          side={
            <SidePanel
              run={
                <RunPanel session={session} runtime={runtime} onExplainError={ai.explainError} />
              }
              ai={
                <AiPanel
                  agent={agent}
                  follow={followAgent}
                  request={aiRequest}
                  edit={proposal}
                  onShowEdit={ai.showEdit}
                />
              }
            />
          }
        />
      </main>

      {ai.instructionTarget !== null && (
        <EditInstructionDialog
          target={ai.instructionTarget}
          onSubmit={ai.submitInstruction}
          onCancel={ai.cancelInstruction}
        />
      )}
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

  return (
    <ToastProvider>
      <Workspace project={summary.project} />
    </ToastProvider>
  );
}
