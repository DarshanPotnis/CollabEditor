import { createFile, readFileContent, readFileText } from '@collabcode/shared';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createFakeClock } from './fake-clock.js';
import { createStopSource } from './stop-source.js';
import { drive } from './test/support.js';
import { LIVE_TYPING, createLiveTypist, instantTypist, type TextEdit } from './typist.js';

const AGENT = 'collabcode:agent:s1';
const SOURCE = 'function greet() {\n  return "hi";\n}\n';

function fileWith(content: string) {
  const doc = new Y.Doc();
  const fileId = createFile(
    doc,
    { parentId: null, name: 'a.js', content },
    { userId: 'u', userName: 'U' },
  );
  const origins: unknown[] = [];
  doc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
  return { doc, fileId, origins };
}

function edit(
  doc: Y.Doc,
  fileId: string,
  oldText: string,
  newText: string,
  cursors: number[] = [],
): TextEdit {
  return {
    doc,
    fileId,
    oldText,
    newText,
    origin: AGENT,
    onProgress: (cursor) => cursors.push(cursor),
  };
}

describe('live typing', () => {
  it('types the new text in pieces over about a second, each with the agent’s origin', async () => {
    const clock = createFakeClock();
    const { doc, fileId, origins } = fileWith(SOURCE);
    const cursors: number[] = [];
    const newText = `  return "${'hello there, '.repeat(4)}";`;
    const typing = createLiveTypist(clock).replace(
      edit(doc, fileId, '  return "hi";', newText, cursors),
      createStopSource().signal,
    );
    await drive(clock, typing);

    expect(readFileContent(doc, fileId)).toBe(`function greet() {\n${newText}\n}\n`);
    expect(origins.length).toBeGreaterThan(10);
    expect(origins.every((origin) => origin === AGENT)).toBe(true);
    expect(clock.now()).toBeGreaterThanOrEqual(LIVE_TYPING.durationMs * 0.8);
    expect(clock.now()).toBeLessThanOrEqual(LIVE_TYPING.durationMs);
    expect(cursors).toEqual([...cursors].sort((a, b) => a - b));
  });

  it('ends with what instant typing gives', async () => {
    const live = fileWith(SOURCE);
    const instant = fileWith(SOURCE);
    const clock = createFakeClock();
    const change = await drive(
      clock,
      createLiveTypist(clock).replace(
        edit(live.doc, live.fileId, '"hi"', '"hello"'),
        createStopSource().signal,
      ),
    );
    const same = await instantTypist.replace(
      edit(instant.doc, instant.fileId, '"hi"', '"hello"'),
      createStopSource().signal,
    );
    expect(readFileContent(live.doc, live.fileId)).toBe(
      readFileContent(instant.doc, instant.fileId),
    );
    expect(change).toEqual(same);
  });

  it("keeps a collaborator's typing next to the edit outside it", async () => {
    const clock = createFakeClock();
    const agent = fileWith(SOURCE);
    const human = new Y.Doc();
    Y.applyUpdate(human, Y.encodeStateAsUpdate(agent.doc));
    const humanText = readFileText(human, agent.fileId);
    const exchange = (): void => {
      Y.applyUpdate(human, Y.encodeStateAsUpdate(agent.doc, Y.encodeStateVector(human)));
      Y.applyUpdate(agent.doc, Y.encodeStateAsUpdate(human, Y.encodeStateVector(agent.doc)));
    };
    let typedOnce = false;
    const cursors: number[] = [];
    const typing = createLiveTypist(clock).replace(
      {
        ...edit(agent.doc, agent.fileId, '"hi"', '"hello there"', cursors),
        onProgress: (cursor) => {
          cursors.push(cursor);
          if (typedOnce) return;
          typedOnce = true;
          // Right where the agent is typing, and at the top of the file.
          exchange();
          humanText?.insert(cursor, 'X');
          humanText?.insert(0, '// mine\n');
          exchange();
        },
      },
      createStopSource().signal,
    );
    await drive(clock, typing);
    exchange();

    const expected = '// mine\nfunction greet() {\n  return "hello thereX";\n}\n';
    expect(readFileContent(agent.doc, agent.fileId)).toBe(expected);
    expect(humanText?.toJSON()).toBe(expected);
  });

  it('finishes the edit at once when stopped, so a file is never half-typed', async () => {
    const clock = createFakeClock();
    const { doc, fileId } = fileWith(SOURCE);
    const stop = createStopSource();
    const typing = createLiveTypist(clock).replace(
      edit(doc, fileId, '"hi"', `"${'x'.repeat(200)}"`),
      stop.signal,
    );
    clock.advance(LIVE_TYPING.frameMs);
    stop.stop();
    await typing;
    expect(readFileContent(doc, fileId)).toBe(SOURCE.replace('"hi"', `"${'x'.repeat(200)}"`));
    expect(clock.now()).toBeLessThan(LIVE_TYPING.durationMs);
  });

  it('types at once in a hidden tab, and for a very long insertion', async () => {
    for (const [instant, newText] of [
      [true, '"hello"'],
      [false, `"${'y'.repeat(LIVE_TYPING.maxChars + 1)}"`],
    ] as const) {
      const clock = createFakeClock();
      const { doc, fileId, origins } = fileWith(SOURCE);
      await createLiveTypist(clock, () => instant).replace(
        edit(doc, fileId, '"hi"', newText),
        createStopSource().signal,
      );
      expect(origins).toEqual([AGENT]);
      expect(clock.now()).toBe(0);
    }
  });

  it('never splits an emoji between two pieces', async () => {
    const clock = createFakeClock();
    const { doc, fileId } = fileWith('x');
    const text = readFileText(doc, fileId);
    const pieces: string[] = [];
    text?.observe((event) => {
      for (const delta of event.delta)
        if (typeof delta.insert === 'string') pieces.push(delta.insert);
    });
    const emoji = '😀'.repeat(60);
    await drive(
      clock,
      createLiveTypist(clock).replace(edit(doc, fileId, 'x', emoji), createStopSource().signal),
    );
    expect(readFileContent(doc, fileId)).toBe(emoji);
    expect(pieces.length).toBeGreaterThan(1);
    // Every piece is whole emoji: a high surrogate always with its low one.
    expect(pieces.every((piece) => /^(?:\ud83d[\ude00-\ude4f])+$/.test(piece))).toBe(true);
  });
});
