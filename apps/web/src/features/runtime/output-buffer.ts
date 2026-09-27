/**
 * Run output, kept independently of any terminal on screen. The runner writes
 * here; a terminal attaches when it mounts, gets the recent history replayed,
 * and then receives new output live. Output written with no terminal attached
 * (the panel is still loading, or the tab is hidden) is not lost.
 *
 * History is capped so a program that prints forever cannot grow memory
 * without bound; the terminal's own scrollback is capped the same way.
 */
export type OutputSink = { write: (text: string) => void };

export type OutputBuffer = OutputSink & {
  /** Replays history into the sink, then forwards. Returns a detach function. */
  attach: (sink: OutputSink) => () => void;
  /** The last `maxChars` of output, raw, for Explain with AI. */
  recent: (maxChars: number) => string;
};

export const MAX_OUTPUT_CHARS = 500_000;

export function createOutputBuffer(maxChars = MAX_OUTPUT_CHARS): OutputBuffer {
  let history = '';
  const sinks = new Set<OutputSink>();

  return {
    write(text) {
      history = (history + text).slice(-maxChars);
      for (const sink of sinks) sink.write(text);
    },
    attach(sink) {
      if (history !== '') sink.write(history);
      sinks.add(sink);
      return () => {
        sinks.delete(sink);
      };
    },
    recent(maxChars) {
      return maxChars <= 0 ? '' : history.slice(-maxChars);
    },
  };
}
