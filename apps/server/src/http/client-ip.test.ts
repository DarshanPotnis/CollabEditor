import { describe, expect, it } from 'vitest';
import { clientIp, clientKey, type IpRequest } from './client-ip.js';

const PROXY = '10.0.0.7';

function request(forwardedFor?: string | string[]): IpRequest {
  return {
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress: PROXY },
  };
}

describe('clientIp behind Render', () => {
  it('takes the first X-Forwarded-For entry, which Render sets to the client', () => {
    expect(clientIp(request('203.0.113.9, 172.68.1.2, 10.10.0.1'), 'render')).toBe('203.0.113.9');
  });

  it('ignores however many proxy entries follow it', () => {
    expect(clientIp(request('203.0.113.9'), 'render')).toBe('203.0.113.9');
    expect(clientIp(request('203.0.113.9, 1.1.1.1, 2.2.2.2, 3.3.3.3'), 'render')).toBe(
      '203.0.113.9',
    );
  });

  it('reads an IPv6 client', () => {
    expect(clientIp(request('2001:db8::5, 172.68.1.2'), 'render')).toBe('2001:db8::5');
  });

  it('falls back to the socket address when there is no header', () => {
    expect(clientIp(request(), 'render')).toBe(PROXY);
  });

  it.each([
    ['garbage', 'not-an-ip, 1.2.3.4'],
    ['an empty first entry', ', 1.2.3.4'],
    ['a port on the address', '203.0.113.9:4000'],
  ])('falls back to the socket address for %s', (_label, header) => {
    expect(clientIp(request(header), 'render')).toBe(PROXY);
  });

  it('uses the first header when it arrives as several', () => {
    expect(clientIp(request(['203.0.113.9', '1.1.1.1']), 'render')).toBe('203.0.113.9');
  });
});

describe('clientIp without a proxy', () => {
  it('ignores X-Forwarded-For entirely, since the client wrote it', () => {
    expect(clientIp(request('203.0.113.9'), 'direct')).toBe(PROXY);
  });
});

describe('clientKey', () => {
  it('unwraps an IPv4-mapped socket address', () => {
    const req = { headers: {}, socket: { remoteAddress: '::ffff:198.51.100.4' } };
    expect(clientKey(req, 'direct')).toBe('198.51.100.4');
  });

  it('groups IPv6 clients by /56, so rotating addresses in one range shares a bucket', () => {
    const a = clientKey(request('2001:db8:abcd:1200::1'), 'render');
    const b = clientKey(request('2001:db8:abcd:12ff::9'), 'render');
    const other = clientKey(request('2001:db8:abcd:1300::1'), 'render');
    expect(a).toBe(b);
    expect(a).not.toBe(other);
  });
});
