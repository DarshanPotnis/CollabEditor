/**
 * Terminal output as the plain text a person saw. Output carries colour and
 * cursor codes, `\r\n` line ends, and progress lines that redraw themselves
 * with `\r`; those become what the terminal finally showed. Used wherever the
 * app reads run output rather than shows it: to spot a crash, and to send it
 * to the AI.
 */

/**
 * CSI sequences (colours, cursor moves), OSC sequences (titles, links), and
 * the short escapes such as ESC c, which `node --watch` sends to clear the
 * screen before a restart.
 */
// eslint-disable-next-line no-control-regex -- matching terminal control codes is the point
const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[ -/]*[0-~]/g;

/** Control characters other than line feed and tab, left over after the escapes. */
// eslint-disable-next-line no-control-regex -- as above
const CONTROLS = /[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * Moving the cursor to the first column (CSI G, 0G or 1G), which is how npm's
 * spinner redraws its line instead of with a carriage return.
 */
// eslint-disable-next-line no-control-regex -- as above
const TO_FIRST_COLUMN = /\x1b\[[01]?G/g;

/** What a line finally showed: text before a `\r` was drawn over. */
function lastDrawn(line: string): string {
  const carriageReturn = line.lastIndexOf('\r');
  return carriageReturn === -1 ? line : line.slice(carriageReturn + 1);
}

export function plainTerminalText(raw: string): string {
  return raw
    .replace(TO_FIRST_COLUMN, '\r')
    .replace(ESCAPES, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => lastDrawn(line).replace(CONTROLS, ''))
    .join('\n');
}
