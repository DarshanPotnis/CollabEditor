/**
 * Who is calling, for per-IP rate limits (docs/PLAN-AI.md §6.1).
 *
 * On Render, requests reach us through Cloudflare and then Render's load
 * balancers, so the socket address is a proxy's. Render's stated contract is
 * that it sets the *first* X-Forwarded-For entry to the real client IP. How
 * many entries follow depends on what the client itself sent, so Express's
 * hop-counting `trust proxy: N` cannot pick the right one; this reads the first
 * entry explicitly, and only when told to (`render`). Anywhere else (`direct`)
 * the header is ignored, because a client can write anything in it.
 *
 * Do not use `req.ip` for limits: `trust proxy` is left unset, so it is the
 * socket address.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

export const CLIENT_IP_SOURCES = ['render', 'direct'] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];

/** The parts of a request this reads. */
export type IpRequest = {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
};

export function clientIp(req: IpRequest, source: ClientIpSource): string {
  const socketAddress = req.socket.remoteAddress ?? 'unknown';
  if (source === 'direct') return socketAddress;

  const header = req.headers['x-forwarded-for'];
  const first = (Array.isArray(header) ? header[0] : header)?.split(',')[0]?.trim();
  // Anything that is not an address falls back to the socket, rather than
  // becoming a rate-limit bucket of its own.
  return first !== undefined && isIP(first) !== 0 ? first : socketAddress;
}

/**
 * The rate-limit key for a request: its client IP, with IPv4-mapped addresses
 * unwrapped and IPv6 grouped by /56, since one household or phone typically
 * holds a whole IPv6 range.
 */
export function clientKey(req: IpRequest, source: ClientIpSource): string {
  return ipKeyGenerator(clientIp(req, source));
}
