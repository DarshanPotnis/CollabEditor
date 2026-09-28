import { MAX_AGENT_STATUS_LENGTH, parseAwarenessState, PRESENCE_COLORS } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import { toolStatus } from './agent-status.js';

describe('toolStatus', () => {
  it.each([
    ['read_file', { path: 'routes/users.js' }, 'Reading routes/users.js'],
    [
      'edit_file',
      { path: 'routes/users.js', oldText: 'a', newText: 'b' },
      'Editing routes/users.js',
    ],
    ['http_request', { method: 'DELETE', path: '/users/1' }, 'Calling DELETE /users/1'],
    ['run_command', { command: 'npm', args: ['test'] }, 'Running npm'],
    ['run_project', {}, 'Running the project'],
    ['no_such_tool', { path: 'x' }, 'Thinking'],
  ])('%s says %j', (tool, input, status) => {
    expect(toolStatus(tool, input)).toBe(status);
  });

  it('keeps the end of a long path and stays within what awareness accepts', () => {
    const status = toolStatus('edit_file', { path: `${'deep/'.repeat(40)}file.js` });
    expect(status.startsWith('Editing …')).toBe(true);
    expect(status.endsWith('/file.js')).toBe(true);
    expect(Array.from(status).length).toBeLessThanOrEqual(MAX_AGENT_STATUS_LENGTH);
    const state = {
      user: { id: 'agent-s', name: 'AI teammate', color: PRESENCE_COLORS[0], kind: 'agent' },
      agent: { hostUserId: 'h', hostName: 'H', sessionId: 's', status },
    };
    expect(parseAwarenessState(state)?.agent?.status).toBe(status);
  });

  it('ignores arguments of the wrong type', () => {
    expect(toolStatus('read_file', { path: 42 })).toBe('Reading');
  });
});
