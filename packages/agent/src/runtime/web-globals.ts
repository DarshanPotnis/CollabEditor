/**
 * The few web APIs the runtime helpers use, which browsers and Node both have
 * as globals. The core's build has no DOM or Node types (it must run in
 * both), so they are described here and read from globalThis rather than
 * declared as ambient globals, which would clash with Node's own types in the
 * test config.
 */
type WebGlobals = {
  TextEncoder: new () => { encode: (text: string) => Uint8Array };
  TextDecoder: new (
    label?: string,
    options?: { fatal?: boolean },
  ) => { decode: (bytes: Uint8Array) => string };
  btoa: (data: string) => string;
  atob: (data: string) => string;
  crypto: { randomUUID: () => string };
};

export const web = globalThis as unknown as WebGlobals;
