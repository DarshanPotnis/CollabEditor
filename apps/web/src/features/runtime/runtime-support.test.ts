import { describe, expect, it } from 'vitest';
import { browserFamily, runtimeSupport } from './runtime-support.js';

const UA = {
  chrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:141.0) Gecko/20100101 Firefox/141.0',
  safari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1',
};

describe('browserFamily', () => {
  it('tells the families apart, even though Chromium user agents also say Safari', () => {
    expect(browserFamily(UA.chrome)).toBe('chromium');
    expect(browserFamily(UA.edge)).toBe('chromium');
    expect(browserFamily(UA.firefox)).toBe('firefox');
    expect(browserFamily(UA.safari)).toBe('safari');
    expect(browserFamily(UA.chromeIos)).toBe('chromium');
    expect(browserFamily('curl/8.0')).toBe('other');
  });
});

describe('runtimeSupport', () => {
  it('refuses when the page is not cross-origin isolated, whatever the browser', () => {
    expect(runtimeSupport({ crossOriginIsolated: false, userAgent: UA.chrome })).toMatchObject({
      kind: 'unsupported',
      message: expect.stringContaining('You can still edit') as unknown,
    });
  });

  it('fully supports Chromium browsers', () => {
    expect(runtimeSupport({ crossOriginIsolated: true, userAgent: UA.edge })).toEqual({
      kind: 'supported',
    });
  });

  it('warns, without refusing, on Safari and Firefox', () => {
    expect(runtimeSupport({ crossOriginIsolated: true, userAgent: UA.safari })).toMatchObject({
      kind: 'limited',
      message: expect.stringContaining('16.4') as unknown,
    });
    expect(runtimeSupport({ crossOriginIsolated: true, userAgent: UA.firefox }).kind).toBe(
      'limited',
    );
  });
});
