import { describe, expect, it } from 'vitest';
import {
  browserFamily,
  isolationProblem,
  runtimeSupport,
  type PageIsolation,
} from './runtime-support.js';

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

const ISOLATED: PageIsolation = {
  crossOriginIsolated: true,
  isSecureContext: true,
  embedded: false,
};
const HEADERS_MISSING: PageIsolation = { ...ISOLATED, crossOriginIsolated: false };

describe('isolationProblem', () => {
  it('has nothing to say about an isolated page', () => {
    expect(isolationProblem(ISOLATED)).toBeNull();
  });

  it('names the cause, so the person knows what to fix', () => {
    expect(isolationProblem({ ...ISOLATED, crossOriginIsolated: undefined })).toContain(
      'this browser does not have',
    );
    expect(isolationProblem({ ...HEADERS_MISSING, isSecureContext: false })).toContain(
      'only on HTTPS or localhost',
    );
    expect(isolationProblem({ ...HEADERS_MISSING, embedded: true })).toContain(
      "inside another site's frame",
    );
    expect(isolationProblem(HEADERS_MISSING)).toContain('without the headers that turn it on');
  });

  it('says editing still works, and never blames cookies, which cannot cause it', () => {
    for (const page of [
      HEADERS_MISSING,
      { ...HEADERS_MISSING, isSecureContext: false },
      { ...HEADERS_MISSING, embedded: true },
      { ...ISOLATED, crossOriginIsolated: undefined },
    ]) {
      expect(isolationProblem(page)).toContain('You can still edit.');
      expect(isolationProblem(page)).not.toMatch(/cookie/i);
    }
  });
});

describe('runtimeSupport', () => {
  it('refuses when the page is not cross-origin isolated, whatever the browser', () => {
    expect(runtimeSupport({ ...HEADERS_MISSING, userAgent: UA.chrome })).toEqual({
      kind: 'unsupported',
      message: isolationProblem(HEADERS_MISSING),
    });
  });

  it('fully supports Chromium browsers', () => {
    expect(runtimeSupport({ ...ISOLATED, userAgent: UA.edge })).toEqual({ kind: 'supported' });
  });

  it('warns, without refusing, on Safari and Firefox', () => {
    expect(runtimeSupport({ ...ISOLATED, userAgent: UA.safari })).toMatchObject({
      kind: 'limited',
      message: expect.stringContaining('16.4') as unknown,
    });
    expect(runtimeSupport({ ...ISOLATED, userAgent: UA.firefox }).kind).toBe('limited');
  });
});
