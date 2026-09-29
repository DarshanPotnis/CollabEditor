/**
 * Which ports a Linux network namespace listens on, from /proc/net/tcp and
 * /proc/net/tcp6: the rows in state 0A (LISTEN), whose local address ends in
 * the port in hex. The WebContainer tells the browser when a server opens a
 * port; in the sandbox this is how a server is found, whatever port it chose.
 */
const LISTEN = '0A';

export function listeningPorts(procNetTcp: string): number[] {
  const ports = new Set<number>();
  for (const line of procNetTcp.split('\n')) {
    const fields = line.trim().split(/\s+/);
    const local = fields[1];
    if (fields[3] !== LISTEN || local === undefined) continue;
    const port = Number.parseInt(local.slice(local.lastIndexOf(':') + 1), 16);
    if (Number.isInteger(port) && port > 0) ports.add(port);
  }
  return [...ports].sort((a, b) => a - b);
}
