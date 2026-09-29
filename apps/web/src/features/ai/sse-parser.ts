/**
 * Splits a server-sent events stream into the data of each event, however the
 * network chunks it: an event can arrive in pieces, or the whole stream in one
 * go when a proxy buffers it.
 *
 * It reads what the format defines for `data:` lines, which is all our server
 * sends: an event ends at a blank line, and several `data:` lines join with
 * line breaks. Comments and other fields are skipped. Lines may end in `\n` or
 * `\r\n`; a lone `\r`, which the format also allows, is not supported. An
 * event cut off by the end of the stream is never completed, which is how the
 * format says to treat it.
 */
export type SseParser = {
  /** Feeds the next piece of text and returns the data of each event it completes. */
  push: (text: string) => string[];
};

export function createSseParser(): SseParser {
  let pending = '';
  let dataLines: string[] = [];

  /** Returns the event's data when this line ends an event. */
  function takeLine(line: string): string | null {
    if (line === '') {
      if (dataLines.length === 0) return null;
      const data = dataLines.join('\n');
      dataLines = [];
      return data;
    }
    if (line.startsWith(':')) return null;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== 'data') return null;
    const value = colon === -1 ? '' : line.slice(colon + 1);
    dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
    return null;
  }

  return {
    push(text) {
      pending += text;
      const completed: string[] = [];
      let start = 0;
      for (let end = pending.indexOf('\n'); end !== -1; end = pending.indexOf('\n', start)) {
        const line = pending.slice(start, end);
        start = end + 1;
        const data = takeLine(line.endsWith('\r') ? line.slice(0, -1) : line);
        if (data !== null) completed.push(data);
      }
      pending = pending.slice(start);
      return completed;
    },
  };
}
