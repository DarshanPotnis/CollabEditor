/**
 * The AI agent's tools (docs/PLAN-AI.md §4): what each one is for and the
 * shape of its input. Defined once and used three ways:
 *
 * - the server declares them to the model (the agent prompt owns them, and a
 *   client has no way to send tools of its own);
 * - the agent core validates every call the model makes against them;
 * - the eval harness (AI-4) runs the same core, so the same checks.
 *
 * Refinements (`.refine`) are checked by the core only; the model sees the
 * plain JSON Schema, which every provider understands.
 */
import { z } from 'zod';
import type { ToolSet } from './prompt.js';

export const AGENT_TOOL_LIMITS = {
  pathChars: 1_024,
  queryChars: 200,
  /** One side of an edit, or a new file. Larger changes belong in several edits. */
  editChars: 60_000,
  readLines: 100_000,
  terminalLines: 500,
  commandArgs: 20,
  commandArgChars: 500,
  headers: 20,
  headerNameChars: 100,
  headerValueChars: 2_000,
  requestBodyChars: 64_000,
  urlPathChars: 2_048,
  summaryChars: 4_000,
} as const;

/** HTTP methods http_request may send to the project's own server. */
export const AGENT_HTTP_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
] as const;

/** Programs run_command may start inside the sandbox. */
export const AGENT_COMMANDS = ['node', 'npm'] as const;

const path = z
  .string()
  .min(1)
  .max(AGENT_TOOL_LIMITS.pathChars)
  .describe('A path in the project, such as "routes/users.js", exactly as list_files shows it');

const line = z.number().int().min(1).max(AGENT_TOOL_LIMITS.readLines);

const noInput = z.object({});

export const AGENT_TOOLS = {
  list_files: {
    description: 'List every file and folder in the project, with file sizes in characters.',
    input: noInput,
  },
  read_file: {
    description:
      "Read a file with its real line numbers. A long file is cut off with a marker saying so; use startLine and endLine to read the rest. Trust these line numbers, not a stack trace's.",
    input: z
      .object({
        path,
        startLine: line.optional().describe('First line to show, from 1'),
        endLine: line.optional().describe('Last line to show'),
      })
      .refine(
        ({ startLine, endLine }) =>
          startLine === undefined || endLine === undefined || endLine >= startLine,
        { message: 'endLine must not be before startLine.' },
      ),
  },
  search_code: {
    description:
      'Find text in every file, ignoring case. Returns each match as path:line: text, with real line numbers.',
    input: z.object({
      query: z
        .string()
        .min(1)
        .max(AGENT_TOOL_LIMITS.queryChars)
        .describe('Plain text, not a regex'),
    }),
  },
  edit_file: {
    description:
      'Replace oldText with newText in a file. oldText must appear exactly once, so copy it exactly from read_file (without line numbers) and include a few surrounding lines. To fill an empty file, use an empty oldText.',
    input: z.object({
      path,
      oldText: z.string().max(AGENT_TOOL_LIMITS.editChars),
      newText: z.string().max(AGENT_TOOL_LIMITS.editChars),
    }),
  },
  create_file: {
    description:
      'Create a new file with the given content. Missing folders on its path are created too. Refused if something already has that path.',
    input: z.object({ path, content: z.string().max(AGENT_TOOL_LIMITS.editChars) }),
  },
  rename_file: {
    description: 'Rename or move a file or folder. newPath is the full new path.',
    input: z.object({ path, newPath: path }),
  },
  delete_file: {
    description:
      'Delete a file or folder. People can restore it from Recently deleted, so it is never lost.',
    input: z.object({ path }),
  },
  run_project: {
    description:
      'Start the project (npm install when its dependencies changed, then its dev or start script), or restart it if it is running. Returns whether it is serving, crashed or failed, and its recent output. After an edit, a running project restarts by itself; there is no need to call this again.',
    input: noInput,
  },
  stop_project: {
    description: 'Stop the running project.',
    input: noInput,
  },
  read_terminal: {
    description: "The last lines of the running project's output.",
    input: z.object({
      lines: z
        .number()
        .int()
        .min(1)
        .max(AGENT_TOOL_LIMITS.terminalLines)
        .optional()
        .describe('How many lines, 80 by default'),
    }),
  },
  http_request: {
    description:
      "Send an HTTP request to the project's running server, on localhost. Returns the status, headers and body.",
    input: z.object({
      method: z.enum(AGENT_HTTP_METHODS),
      path: z
        .string()
        .min(1)
        .max(AGENT_TOOL_LIMITS.urlPathChars)
        .refine((value) => value.startsWith('/'), { message: 'path must start with /.' })
        .describe('Path and query, starting with /, such as "/users/1"'),
      headers: z
        .array(
          z.object({
            name: z.string().min(1).max(AGENT_TOOL_LIMITS.headerNameChars),
            value: z.string().max(AGENT_TOOL_LIMITS.headerValueChars),
          }),
        )
        .max(AGENT_TOOL_LIMITS.headers)
        .optional(),
      body: z.string().max(AGENT_TOOL_LIMITS.requestBodyChars).optional(),
    }),
  },
  run_command: {
    description:
      "Run node or npm in the project folder, inside the sandbox, when the goal needs it, for example to run the project's existing tests. It is stopped after 60 seconds. Returns its exit code and output.",
    input: z.object({
      command: z.enum(AGENT_COMMANDS),
      args: z
        .array(z.string().max(AGENT_TOOL_LIMITS.commandArgChars))
        .max(AGENT_TOOL_LIMITS.commandArgs),
    }),
  },
  finish: {
    description:
      'End the session. The summary is shown to the person who asked: what you changed, how you checked it, and anything left to do.',
    input: z.object({ summary: z.string().trim().min(1).max(AGENT_TOOL_LIMITS.summaryChars) }),
  },
} as const satisfies ToolSet;

export type AgentToolName = keyof typeof AGENT_TOOLS;

export const AGENT_TOOL_NAMES = Object.keys(AGENT_TOOLS) as AgentToolName[];

/** A tool call's input once it has been validated. */
export type AgentToolInput<Name extends AgentToolName> = z.output<
  (typeof AGENT_TOOLS)[Name]['input']
>;

export function isAgentToolName(name: string): name is AgentToolName {
  return Object.hasOwn(AGENT_TOOLS, name);
}
