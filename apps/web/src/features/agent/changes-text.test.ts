import { describe, expect, it } from 'vitest';
import { changesText } from './changes-text.js';

const none = { created: [], edited: [], renamed: [], deleted: [] };

describe('changesText', () => {
  it('says nothing for no changes', () => {
    expect(changesText(none)).toBeNull();
  });

  it('lists each kind of change as a sentence, joining names the way people do', () => {
    expect(
      changesText({
        created: ['test/users.test.js'],
        edited: ['index.js', 'routes/users.js', 'package.json'],
        renamed: [{ from: 'a.js', to: 'b.js' }],
        deleted: ['old.js', 'tmp'],
      }),
    ).toBe(
      'Edited index.js, routes/users.js and package.json. Created test/users.test.js. Renamed a.js to b.js. Deleted old.js and tmp.',
    );
    expect(changesText({ ...none, edited: ['index.js'] })).toBe('Edited index.js.');
  });
});
