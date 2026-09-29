import { describe, expect, it } from 'vitest';
import { divergenceText, recordingNote, replayBanner } from './replay-labels.js';

describe('the replay’s words', () => {
  it('says what was recorded, when and with what, and that no AI is running', () => {
    expect(
      replayBanner({
        recordedAt: Date.UTC(2026, 8, 29, 18, 26),
        prompt: 'agent@5',
        model: 'gemini-3.5-flash-lite',
      }),
    ).toBe(
      'Replay of a recorded session (recorded 2026-09-29 with agent@5 on gemini-3.5-flash-lite). No AI is running: the model’s answers are the recording’s, and the edits, runs and checks are happening now.',
    );
    expect(replayBanner({ recordedAt: 0, prompt: null, model: null })).toMatch(
      /^Replay of a recorded session \(recorded 1970-01-01\)\./,
    );
  });

  it('says where a replay stopped matching, both ways', () => {
    expect(
      divergenceText({
        step: 2,
        toolName: 'edit_file',
        recorded: 'edited lines 12–16',
        now: 'error: Someone else is editing routes/users.js right now',
      }),
    ).toBe(
      'The replay stopped at step 2: today’s code answered edit_file differently from the recording, so the rest of it no longer fits. Recorded: edited lines 12–16. Now: error: Someone else is editing routes/users.js right now.',
    );
  });

  it('labels a recording as one, and names the browsers a live replay needs', () => {
    expect(recordingNote()).toContain('nothing in it is happening now');
    expect(recordingNote()).toContain('Chrome, Edge or Arc');
  });
});
