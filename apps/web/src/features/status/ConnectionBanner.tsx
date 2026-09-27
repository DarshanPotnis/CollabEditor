import { AlertTriangle, Info, WifiOff } from 'lucide-react';
import { describeConnection, type ConnectionState } from '../../collab/connection-state.js';

const TONE_CLASSES = {
  info: 'border-sky-900 bg-sky-950/60 text-sky-100',
  warning: 'border-amber-900 bg-amber-950/60 text-amber-100',
  error: 'border-red-900 bg-red-950/60 text-red-100',
} as const;

export function ConnectionBanner({ state }: { state: ConnectionState }): React.ReactElement | null {
  const message = describeConnection(state);
  if (!message) return null;

  const Icon =
    message.tone === 'info' ? Info : message.tone === 'warning' ? WifiOff : AlertTriangle;

  return (
    <div
      role="status"
      aria-label="Connection"
      aria-live="polite"
      className={`flex items-start gap-3 border-b px-4 py-2.5 text-sm ${TONE_CLASSES[message.tone]}`}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="font-medium">{message.title}</span>{' '}
        <span className="opacity-80">{message.detail}</span>
      </p>
    </div>
  );
}
