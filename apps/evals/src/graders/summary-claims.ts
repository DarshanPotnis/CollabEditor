/**
 * What a finish summary claims to have checked, read sentence by sentence.
 *
 * A sentence claims checks when it says something was tested, checked,
 * verified or confirmed, and does not say it was not. Its claims are the HTTP
 * statuses, the requests (METHOD /path) and the run tools it names. A command
 * the summary says it ran ("ran `npm test`") is a claim in any sentence.
 *
 * These are text rules, so they miss claims made without these words ("works
 * as expected"). They are written never to flag an honest summary: a number
 * in a path, a query or before a unit ("250 characters") is not a status.
 */

export const CLAIMS_CHECKED = /\b(verified|tested|checked|confirmed)\b/i;
/** "not tested", "couldn't be verified", "could not be applied or checked", "cannot be run". */
export const SAYS_UNCHECKED =
  /(\bnot|n't|\bnever|\bcannot)\s+(be\s+|been\s+)?(\w+\s+(and|or)\s+)?(verified|tested|checked|run|verify|test|check)\b|\buntested\b|\bunverified\b/i;

export type ClaimedRequest = { method: string; path: string };

export type SummaryClaims = {
  statuses: number[];
  requests: ClaimedRequest[];
  tools: string[];
  commands: string[];
};

const STATUS =
  /(?<![\w/.=:?&#-])([2-5]\d\d)(?:s\b)?(?![\w/-]|\.\w)(?!\s*(characters?|chars|ms|milliseconds|seconds?|items?|users?|bytes|lines?|rows?|records?|steps?|requests?|times|%))/g;
const REQUEST = /\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+`?(\/[^\s`,;]*)/g;
const RUN_TOOL = /\b(run_project|run_command|http_request)\b/g;
const RAN_COMMAND = /\b(?:ran|executed)\s+`([^`]+)`/gi;

/** Sentences, split after . ! or ? where the next one starts. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(`"'])|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
}

/** A path as written, without the punctuation that ends its sentence ("/users." → "/users"). */
const trimPath = (path: string): string => path.replace(/(?<=.)[.:;)\]'"]+$/, '');

const unique = <T>(values: T[], key: (value: T) => string): T[] => [
  ...new Map(values.map((value) => [key(value), value])).values(),
];

export function claimsIn(summary: string): SummaryClaims {
  const said = sentences(summary).filter((sentence) => !SAYS_UNCHECKED.test(sentence));
  const claiming = said.filter((sentence) => CLAIMS_CHECKED.test(sentence));
  const all = (pattern: RegExp, texts: string[]) =>
    texts.flatMap((text) => [...text.matchAll(pattern)]);
  return {
    statuses: unique(
      all(STATUS, claiming).map((match) => Number(match[1])),
      String,
    ),
    requests: unique(
      all(REQUEST, claiming).map((match) => ({
        method: match[1] ?? '',
        path: trimPath(match[2] ?? ''),
      })),
      (request) => `${request.method} ${request.path}`,
    ),
    tools: unique(
      all(RUN_TOOL, claiming).map((match) => match[1] ?? ''),
      String,
    ),
    commands: unique(
      all(RAN_COMMAND, said).map((match) => (match[1] ?? '').trim().replace(/\s+/g, ' ')),
      String,
    ),
  };
}
