/**
 * What the agent's status says in the room, such as "Editing routes/users.js".
 * Built from fixed phrases and the tool's own arguments, never from the
 * model's free text, and capped to what awareness allows.
 */
import { MAX_AGENT_STATUS_LENGTH } from '@collabcode/shared';

export const AGENT_STATUS = {
  starting: 'Starting',
  thinking: 'Thinking',
  busy: 'Waiting: the AI model is busy',
  rateLimited: 'Waiting for the free AI tier',
  finished: 'Finished',
  stopped: 'Stopped',
  undone: 'Its changes were undone',
} as const;

function field(input: unknown, name: string): string | null {
  if (typeof input !== 'object' || input === null || !(name in input)) return null;
  const value: unknown = (input as Record<string, unknown>)[name];
  return typeof value === 'string' ? value : null;
}

/** Keep the end of a long path, where the file name is. */
function shorten(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `…${chars.slice(chars.length - max + 1).join('')}`;
}

const PATH_ROOM = 50;

export function toolStatus(toolName: string, input: unknown): string {
  const path = shorten(field(input, 'path') ?? '', PATH_ROOM);
  const status = ((): string => {
    switch (toolName) {
      case 'list_files':
        return 'Looking at the files';
      case 'read_file':
        return `Reading ${path}`;
      case 'search_code':
        return 'Searching the code';
      case 'edit_file':
        return `Editing ${path}`;
      case 'create_file':
        return `Creating ${path}`;
      case 'rename_file':
        return `Renaming ${path}`;
      case 'delete_file':
        return `Deleting ${path}`;
      case 'run_project':
        return 'Running the project';
      case 'stop_project':
        return 'Stopping the project';
      case 'read_terminal':
        return 'Reading the terminal';
      case 'http_request':
        return `Calling ${field(input, 'method') ?? 'the API'} ${path}`;
      case 'run_command':
        return `Running ${field(input, 'command') ?? 'a command'}`;
      case 'finish':
        return 'Finishing';
      default:
        return AGENT_STATUS.thinking;
    }
  })();
  return shorten(status.trim(), MAX_AGENT_STATUS_LENGTH);
}
