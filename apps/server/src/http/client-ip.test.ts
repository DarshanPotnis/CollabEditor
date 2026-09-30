import type { IncomingHttpHeaders } from 'node:http';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import {
  clientAddress,
  clientIp,
  clientKey,
  warnOnceUntrusted,
  type IpRequest,
} from './client-ip.js';

/** The socket address: Render's last hop. */
const PROXY = '10.0.0.7';
/** The client, and the two addresses Render's hops append after it. */
const CLIENT = '81.2.69.160';
const HOPS = '172.70.1.2, 10.20.0.3';

function request(headers: IncomingHttpHeaders = {}): IpRequest {
  return { headers, socket: { remoteAddress: PROXY } };
}

/** What Render's proxies deliver for a client that sent `forwardedFor` (if anything). */
function throughRender(
  client: string,
  { forwardedFor, extra = {} }: { forwardedFor?: string; extra?: IncomingHttpHeaders } = {},
): IpRequest {
  return request({
    'x-forwarded-for': [forwardedFor, client, HOPS].filter(Boolean).join(', '),
    'cf-connecting-ip': client,
    ...extra,
  });
}

describe('clientIp behind Render', () => {
  it('takes CF-Connecting-IP when it is the entry Cloudflare appended, third from the right', () => {
    expect(clientAddress(throughRender(CLIENT), 'render')).toEqual({
      trusted: true,
      address: CLIENT,
    });
  });

  it('never takes a forged X-Forwarded-For entry, however many the client sends', () => {
    for (const forwardedFor of [
      '203.0.113.1',
      '203.0.113.1, 198.51.100.2',
      `${CLIENT}, 192.0.2.5`,
    ]) {
      expect(clientIp(throughRender(CLIENT, { forwardedFor }), 'render')).toBe(CLIENT);
    }
  });

  it('ignores a forged True-Client-IP and X-Real-IP', () => {
    const forged = throughRender(CLIENT, {
      extra: { 'true-client-ip': '192.0.2.9', 'x-real-ip': '192.0.2.10' },
    });
    expect(clientIp(forged, 'render')).toBe(CLIENT);
  });

  it('refuses a forged CF-Connecting-IP that is not what Cloudflare appended, keying by the socket', () => {
    // Cloudflare refuses these today (403, error 1000), so this only matters
    // if something ever lets one through.
    const forged = request({
      'x-forwarded-for': `203.0.113.1, ${CLIENT}, ${HOPS}`,
      'cf-connecting-ip': '203.0.113.1',
    });
    expect(clientAddress(forged, 'render')).toEqual({
      trusted: false,
      address: PROXY,
      reason: 'CF-Connecting-IP is not the address Cloudflare appended to X-Forwarded-For',
    });
  });

  it.each<[string, IncomingHttpHeaders, string]>([
    ['no headers', {}, 'no single address in CF-Connecting-IP'],
    [
      'no CF-Connecting-IP',
      { 'x-forwarded-for': `${CLIENT}, ${HOPS}` },
      'no single address in CF-Connecting-IP',
    ],
    [
      'two CF-Connecting-IP values',
      { 'x-forwarded-for': `${CLIENT}, ${HOPS}`, 'cf-connecting-ip': [CLIENT, '203.0.113.1'] },
      'no single address in CF-Connecting-IP',
    ],
    [
      'a chain shorter than Render’s',
      { 'x-forwarded-for': HOPS, 'cf-connecting-ip': CLIENT },
      'X-Forwarded-For is shorter than the proxy chain',
    ],
    [
      'one hop fewer than measured',
      { 'x-forwarded-for': `203.0.113.1, ${CLIENT}, 10.20.0.3`, 'cf-connecting-ip': CLIENT },
      'CF-Connecting-IP is not the address Cloudflare appended to X-Forwarded-For',
    ],
  ])('falls back to the socket for %s', (_label, headers, reason) => {
    expect(clientAddress(request(headers), 'render')).toEqual({
      trusted: false,
      address: PROXY,
      reason,
    });
  });

  it('matches an IPv6 client whatever the letter case', () => {
    const upper = request({
      'x-forwarded-for': `2001:DB8::5, ${HOPS}`,
      'cf-connecting-ip': '2001:db8::5',
    });
    expect(clientIp(upper, 'render')).toBe('2001:db8::5');
  });
});

describe('clientIp without a proxy', () => {
  it('ignores every forwarding header, since the client wrote them', () => {
    expect(clientIp(throughRender(CLIENT, { forwardedFor: '203.0.113.9' }), 'direct')).toBe(PROXY);
  });
});

describe('clientKey', () => {
  it('unwraps an IPv4-mapped socket address', () => {
    const req = { headers: {}, socket: { remoteAddress: '::ffff:198.51.100.4' } };
    expect(clientKey(req, 'direct')).toBe('198.51.100.4');
  });

  it('groups IPv6 clients by /56, so rotating addresses in one range shares a bucket', () => {
    const a = clientKey(throughRender('2001:db8:abcd:1200::1'), 'render');
    const b = clientKey(throughRender('2001:db8:abcd:12ff::9'), 'render');
    const other = clientKey(throughRender('2001:db8:abcd:1300::1'), 'render');
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });

  it('says why a request fell back to the socket, and nothing for a trusted one', () => {
    const reasons: string[] = [];
    clientKey(throughRender(CLIENT), 'render', (reason) => reasons.push(reason));
    clientKey(request(), 'render', (reason) => reasons.push(reason));
    expect(reasons).toEqual(['no single address in CF-Connecting-IP']);
  });
});

describe('warnOnceUntrusted', () => {
  it('warns once per process, with the reason and no address', () => {
    const lines: string[] = [];
    const logger = pino({ level: 'info' }, { write: (line: string) => lines.push(line) });
    const warn = warnOnceUntrusted(logger);
    warn('no single address in CF-Connecting-IP');
    warn('X-Forwarded-For is shorter than the proxy chain');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({
      level: 40,
      reason: 'no single address in CF-Connecting-IP',
    });
  });
});
