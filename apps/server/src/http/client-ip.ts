/**
 * Who is calling, for per-IP rate limits (docs/PLAN-AI.md §6.1, ADR 015).
 *
 * On Render a request passes through Cloudflare and two Render hops, so the
 * socket address is a proxy's. None of them removes what the client sent in
 * X-Forwarded-For: they append to it, so the leftmost entries are whatever
 * the client wrote. Measured on the live service (2026-09-30), the proxies
 * leave exactly this, whatever the client forged:
 *
 *   X-Forwarded-For:  <client's own entries…>, <client>, <public hop>, <private hop>
 *   CF-Connecting-IP: <client>     (Cloudflare refuses a request that sends its own)
 *
 * So `render` takes CF-Connecting-IP only when it is also the entry Cloudflare
 * appended, third from the right. Either alone could be wrong after a hosting
 * change; when they disagree, or either is missing, the request is keyed by
 * its socket address instead. That is the proxy's, shared by everyone: strict,
 * but never a bucket a client can choose. `direct` (no proxy in front) ignores
 * the headers, because a client can write anything in them.
 *
 * Do not use `req.ip` for limits: `trust proxy` is left unset, so it is the
 * socket address.
 */
import type { IncomingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';
import type { Logger } from '../lib/logger.js';

export const CLIENT_IP_SOURCES = ['render', 'direct'] as const;
export type ClientIpSource = (typeof CLIENT_IP_SOURCES)[number];

/** X-Forwarded-For entries Render's two hops append after the one Cloudflare adds. */
export const RENDER_HOPS_AFTER_CLIENT = 2;

/** The parts of a request this reads. */
export type IpRequest = {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string | undefined };
};

/** A request's rate-limit key, with the source and the untrusted warning bound in. */
export type ClientKeyOf = (req: IpRequest) => string;

export type ClientAddress =
  { trusted: true; address: string } | { trusted: false; address: string; reason: string };

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(', ') : value;
}

export function clientAddress(req: IpRequest, source: ClientIpSource): ClientAddress {
  const socketAddress = req.socket.remoteAddress ?? 'unknown';
  if (source === 'direct') return { trusted: true, address: socketAddress };

  const untrusted = (reason: string): ClientAddress => ({
    trusted: false,
    address: socketAddress,
    reason,
  });
  const connecting = single(req.headers['cf-connecting-ip'])?.trim();
  if (connecting === undefined || isIP(connecting) === 0) {
    return untrusted('no single address in CF-Connecting-IP');
  }
  const entries = (single(req.headers['x-forwarded-for']) ?? '')
    .split(',')
    .map((entry) => entry.trim());
  const appended = entries[entries.length - 1 - RENDER_HOPS_AFTER_CLIENT];
  if (appended === undefined) {
    return untrusted('X-Forwarded-For is shorter than the proxy chain');
  }
  if (appended.toLowerCase() !== connecting.toLowerCase()) {
    return untrusted('CF-Connecting-IP is not the address Cloudflare appended to X-Forwarded-For');
  }
  return { trusted: true, address: connecting };
}

export function clientIp(req: IpRequest, source: ClientIpSource): string {
  return clientAddress(req, source).address;
}

/**
 * The rate-limit key for a request: its client IP, with IPv4-mapped addresses
 * unwrapped and IPv6 grouped by /56, since one household or phone typically
 * holds a whole IPv6 range. `onUntrusted` hears why a request behind Render
 * fell back to the shared socket key.
 */
export function clientKey(
  req: IpRequest,
  source: ClientIpSource,
  onUntrusted?: (reason: string) => void,
): string {
  const found = clientAddress(req, source);
  if (!found.trusted) onUntrusted?.(found.reason);
  return ipKeyGenerator(found.address);
}

/**
 * Warns once per process that per-IP limits have fallen back to the shared
 * proxy address, so a hosting change that breaks the headers is noticed
 * rather than felt as limits that run out for everyone. No address is logged.
 */
export function warnOnceUntrusted(logger: Logger): (reason: string) => void {
  let warned = false;
  return (reason) => {
    if (warned) return;
    warned = true;
    logger.warn(
      { reason },
      'client address headers not trusted: per-IP limits use the proxy address, shared by everyone',
    );
  };
}
