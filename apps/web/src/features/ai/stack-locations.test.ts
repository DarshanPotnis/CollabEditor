import { describe, expect, it } from 'vitest';
import { crashLocation, projectPath } from './stack-locations.js';

const PROJECT = new Set(['index.js', 'routes/users.js', 'lib/db.js', 'my app/main.js']);

describe('projectPath', () => {
  it('finds the project file at the end of a container path, whatever the working directory', () => {
    expect(projectPath('/home/project/routes/users.js', PROJECT)).toBe('routes/users.js');
    expect(projectPath('/home/abc123/index.js', PROJECT)).toBe('index.js');
  });

  it('prefers the longest match', () => {
    const paths = new Set(['users.js', 'routes/users.js']);
    expect(projectPath('/home/project/routes/users.js', paths)).toBe('routes/users.js');
  });

  it('decodes file URL escapes', () => {
    expect(projectPath('/home/project/my%20app/main.js', PROJECT)).toBe('my app/main.js');
  });

  it('never matches a dependency or a file outside the project', () => {
    expect(projectPath('/home/project/node_modules/express/index.js', PROJECT)).toBeNull();
    expect(projectPath('/home/project/other.js', PROJECT)).toBeNull();
  });
});

describe('crashLocation', () => {
  it('points at the innermost project frame of a CommonJS stack', () => {
    const output = [
      '/home/project/routes/users.js:12',
      '  return user.name;',
      '              ^',
      '',
      "TypeError: Cannot read properties of undefined (reading 'name')",
      '    at getName (/home/project/routes/users.js:12:15)',
      '    at Object.<anonymous> (/home/project/index.js:20:3)',
      '    at Module._compile (node:internal/modules/cjs/loader:1554:14)',
      '',
      'Node.js v22.12.0',
    ].join('\n');
    expect(crashLocation(output, PROJECT)).toEqual({
      path: 'routes/users.js',
      line: 12,
      exactLine: true,
    });
  });

  it('reads ES module file URLs, whose line numbers are not exact', () => {
    const output = [
      'ReferenceError: db is not defined',
      '    at file:///home/project/lib/db.js:4:3',
      '    at ModuleJob.run (node:internal/modules/esm/module_job:271:25)',
    ].join('\n');
    expect(crashLocation(output, PROJECT)).toEqual({
      path: 'lib/db.js',
      line: 4,
      exactLine: false,
    });
  });

  it('falls back to the header above the message when the stack has no project frame', () => {
    const output = [
      'file:///home/project/index.js:7',
      'app.get("/", (req, res) => {',
      '                          ^^',
      'SyntaxError: Unexpected token',
      '    at compileSourceTextModule (node:internal/modules/esm/utils:340:16)',
    ].join('\n');
    expect(crashLocation(output, PROJECT)).toMatchObject({ path: 'index.js', line: 7 });
  });

  it('uses the latest error when the output holds several runs', () => {
    const output = [
      'Error: first crash',
      '    at /home/project/lib/db.js:1:1',
      '[restarted]',
      'Error: second crash',
      '    at /home/project/index.js:9:5',
    ].join('\n');
    expect(crashLocation(output, PROJECT)).toMatchObject({ path: 'index.js', line: 9 });
  });

  it('skips frames in dependencies', () => {
    const output = [
      'Error: listen EADDRINUSE: address already in use :::3000',
      '    at Server.setupListenHandle (node:net:1908:16)',
      '    at /home/project/node_modules/express/lib/application.js:635:24',
      '    at Object.<anonymous> (/home/project/index.js:15:5)',
    ].join('\n');
    expect(crashLocation(output, PROJECT)).toMatchObject({ path: 'index.js', line: 15 });
  });

  it('finds nothing when no project file is mentioned', () => {
    expect(crashLocation('npm error Missing script: "start"', PROJECT)).toBeNull();
  });
});
