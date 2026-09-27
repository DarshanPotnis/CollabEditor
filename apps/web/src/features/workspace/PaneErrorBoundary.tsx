import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { pane: string; children: ReactNode };
type State = { error: Error | null };

/**
 * Keeps a crash in one pane from taking down the others: if the file tree
 * breaks, the editor keeps working. "Try again" remounts the pane, which is
 * enough when the cause was a transient state.
 */
export class PaneErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
    console.error(`CollabCode: the ${this.props.pane} pane crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div role="alert" className="flex h-full items-start justify-center p-4">
        <div className="w-full max-w-sm rounded-md border border-red-900 bg-red-950/40 p-4">
          <p className="text-sm font-medium text-red-200">The {this.props.pane} hit a bug.</p>
          <p className="mt-1 text-xs text-red-100/80">
            The rest of the workspace still works, and your files are saved.
          </p>
          <p className="mt-2 font-mono text-xs break-words text-red-200/70">{error.message}</p>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded bg-red-200 px-2.5 py-1 text-xs font-medium text-red-950 hover:bg-red-100"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
}
