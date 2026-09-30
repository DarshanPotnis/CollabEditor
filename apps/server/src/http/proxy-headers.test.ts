import { describe, expect, it } from 'vitest';
import type { IpRequest } from './client-ip.js';
import { addressKind, describeProxyHeaders } from './proxy-headers.js';

const REAL = '81.2.69.160';
const EDGE = '172.70.1.2';
const PROXY = '10.0.0.7';

function request(headers: Record<string, string>): IpRequest {
  return { headers, socket: { remoteAddress: `::ffff:${PROXY}` } };
}

describe('addressKind', () => {
  it.each([
    ['203.0.113.1', 'documentation'],
    ['198.51.100.7', 'documentation'],
    ['192.0.2.55', 'documentation'],
    ['2001:db8::5', 'documentation'],
    ['10.1.2.3', 'private'],
    ['100.64.0.1', 'private'],
    ['::ffff:10.0.0.7', 'private'],
    ['fd00::1', 'private'],
    [REAL, 'public'],
    ['2a00:1450::1', 'public'],
    ['garbage', 'not-an-address'],
    [undefined, 'absent'],
  ])('%s is %s', (value, kind) => {
    expect(addressKind(value)).toBe(kind);
  });
});

describe('describeProxyHeaders', () => {
  const forged = request({
    'x-forwarded-for': `203.0.113.1, ${REAL}, ${EDGE}`,
    'cf-connecting-ip': REAL,
    'true-client-ip': '198.51.100.7',
    host: 'example.onrender.com',
  });

  it('describes each X-Forwarded-For entry by kind and by what it equals', () => {
    expect(describeProxyHeaders(forged).forwardedFor).toEqual([
      { position: 1, fromRight: 3, kind: 'documentation', sameAs: [] },
      { position: 2, fromRight: 2, kind: 'public', sameAs: ['cf-connecting-ip'] },
      { position: 3, fromRight: 1, kind: 'public', sameAs: [] },
    ]);
  });

  it('says which X-Forwarded-For position each candidate header equals', () => {
    const { headers } = describeProxyHeaders(forged);
    expect(headers['cf-connecting-ip']).toEqual({
      kind: 'public',
      sameAsForwardedForFromRight: [2],
    });
    expect(headers['true-client-ip']).toEqual({
      kind: 'documentation',
      sameAsForwardedForFromRight: [],
    });
    expect(headers['x-real-ip']).toEqual({ kind: 'absent', sameAsForwardedForFromRight: [] });
  });

  it('lists header names and the socket kind', () => {
    const description = describeProxyHeaders(forged);
    expect(description.headerNames).toEqual([
      'cf-connecting-ip',
      'host',
      'true-client-ip',
      'x-forwarded-for',
    ]);
    expect(description.socket).toBe('private');
  });

  it('never contains an address', () => {
    const text = JSON.stringify(describeProxyHeaders(forged));
    for (const address of ['203.0.113.1', REAL, EDGE, '198.51.100.7', PROXY]) {
      expect(text).not.toContain(address);
    }
  });
});
