import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence. A crash here means a bug, so it says so plainly and
 * offers the one action that reliably helps.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console -- there is no logging service; the browser console is all we have
    console.error('CollabCode crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-red-900 bg-red-950/40 p-6">
          <h1 className="text-lg font-semibold text-red-200">Something broke</h1>
          <p className="mt-2 text-sm text-red-100/80">
            This is a bug on our side, not something you did. Reloading usually gets you back to
            work; your text is saved on the server.
          </p>
          <p className="mt-3 font-mono text-xs break-words text-red-200/70">{error.message}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-md bg-red-200 px-3 py-1.5 text-sm font-medium text-red-950 hover:bg-red-100"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
