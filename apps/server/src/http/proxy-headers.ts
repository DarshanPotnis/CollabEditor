/**
 * TEMPORARY diagnostic (removed by the client-IP fix): describes how the
 * proxies in front of the server shaped a request's client-address headers,
 * without any address in the result. Each address is reduced to its kind, and
 * the relations between them (which header equals which X-Forwarded-For
 * position) are kept, which is what choosing a trustworthy source needs.
 *
 * Probes send forged values from the documentation ranges (RFC 5737, RFC 3849),
 * so a forged value that survives the proxies shows up as `documentation`.
 */
import { BlockList, isIP } from 'node:net';
import type { IpRequest } from './client-ip.js';

export type AddressKind = 'documentation' | 'private' | 'public' | 'not-an-address' | 'absent';

/** Headers a proxy or CDN commonly uses to pass the client address on. */
export const CANDIDATE_HEADERS = [
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'true-client-ip',
  'x-real-ip',
  'x-client-ip',
  'x-envoy-external-address',
] as const;

type Candidate = (typeof CANDIDATE_HEADERS)[number];

export type ProxyHeadersDescription = {
  /** Every request header's name, sorted; names only. */
  headerNames: string[];
  socket: AddressKind;
  /** Left to right, as received. */
  forwardedFor: { position: number; fromRight: number; kind: AddressKind; sameAs: string[] }[];
  headers: Record<Candidate, { kind: AddressKind; sameAsForwardedForFromRight: number[] }>;
};

const documentation = new BlockList();
documentation.addSubnet('192.0.2.0', 24, 'ipv4');
documentation.addSubnet('198.51.100.0', 24, 'ipv4');
documentation.addSubnet('203.0.113.0', 24, 'ipv4');
documentation.addSubnet('2001:db8::', 32, 'ipv6');

const notPublic = new BlockList();
for (const [network, prefix] of [
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['100.64.0.0', 10],
] as const) {
  notPublic.addSubnet(network, prefix, 'ipv4');
}
notPublic.addAddress('::1', 'ipv6');
notPublic.addSubnet('fc00::', 7, 'ipv6');
notPublic.addSubnet('fe80::', 10, 'ipv6');

/** Strips the IPv4-mapped prefix a Node socket reports, e.g. ::ffff:10.0.0.7. */
function unmapped(address: string): string {
  return address.startsWith('::ffff:') && isIP(address.slice(7)) === 4 ? address.slice(7) : address;
}

export function addressKind(value: string | undefined): AddressKind {
  if (value === undefined) return 'absent';
  const address = unmapped(value.trim());
  const family = isIP(address);
  if (family === 0) return 'not-an-address';
  const type = family === 4 ? 'ipv4' : 'ipv6';
  if (documentation.check(address, type)) return 'documentation';
  if (notPublic.check(address, type)) return 'private';
  return 'public';
}

function headerValue(req: IpRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

export function describeProxyHeaders(req: IpRequest): ProxyHeadersDescription {
  const entries = (headerValue(req, 'x-forwarded-for') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const socketAddress = req.socket.remoteAddress;
  const same = (a: string | undefined, b: string | undefined): boolean =>
    a !== undefined && b !== undefined && unmapped(a.trim()) === unmapped(b.trim());

  const headers = Object.fromEntries(
    CANDIDATE_HEADERS.map((name) => {
      const value = headerValue(req, name);
      return [
        name,
        {
          kind: addressKind(value),
          sameAsForwardedForFromRight: entries
            .map((entry, index) => (same(entry, value) ? entries.length - index : 0))
            .filter((fromRight) => fromRight > 0),
        },
      ];
    }),
  ) as ProxyHeadersDescription['headers'];

  return {
    headerNames: Object.keys(req.headers).sort(),
    socket: addressKind(socketAddress),
    forwardedFor: entries.map((entry, index) => ({
      position: index + 1,
      fromRight: entries.length - index,
      kind: addressKind(entry),
      sameAs: [
        ...(same(entry, socketAddress) ? ['socket'] : []),
        ...CANDIDATE_HEADERS.filter((name) => same(entry, headerValue(req, name))),
      ],
    })),
    headers,
  };
}
