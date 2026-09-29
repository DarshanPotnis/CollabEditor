/**
 * Whether this browser can run the project, and what to tell the person.
 *
 * WebContainers need a cross-origin isolated page (SharedArrayBuffer). Given
 * that, StackBlitz supports Chromium browsers fully, Safari 16.4+ in beta and
 * Firefox in alpha (webcontainers.io/guides/browser-support). Editing never
 * depends on any of this.
 *
 * A page that is not isolated is told why, since each cause has its own fix:
 * isolation needs HTTPS or localhost, a page of its own (not another site's
 * frame), and the COOP and COEP headers (isolation-headers.ts).
 */
export type RuntimeSupport =
  | { kind: 'supported' }
  | { kind: 'limited'; message: string }
  | { kind: 'unsupported'; message: string };

export type BrowserFamily = 'chromium' | 'firefox' | 'safari' | 'other';

export function browserFamily(userAgent: string): BrowserFamily {
  if (/Firefox\//.test(userAgent)) return 'firefox';
  if (/Chrome\/|Chromium\/|CriOS\//.test(userAgent)) return 'chromium';
  if (/Safari\//.test(userAgent)) return 'safari';
  return 'other';
}

const BEST = 'Chrome or Edge work best.';
const STILL_EDIT = 'You can still edit.';

/** What decides whether this page is cross-origin isolated. */
export type PageIsolation = {
  /** Undefined in a browser that does not have the feature at all. */
  crossOriginIsolated: boolean | undefined;
  isSecureContext: boolean;
  /** Inside another page's frame. */
  embedded: boolean;
};

/** This page's isolation, as the browser reports it. */
export function pageIsolation(page: Window = window): PageIsolation {
  const isolated: unknown = page.crossOriginIsolated;
  return {
    crossOriginIsolated: typeof isolated === 'boolean' ? isolated : undefined,
    isSecureContext: page.isSecureContext,
    embedded: page.top !== page.self,
  };
}

/** Why this page cannot run code, in words for the person, or null when it can. */
export function isolationProblem(page: PageIsolation): string | null {
  if (page.crossOriginIsolated === true) return null;
  if (page.crossOriginIsolated === undefined) {
    return `Running code needs cross-origin isolation, which this browser does not have. ${BEST} ${STILL_EDIT}`;
  }
  if (!page.isSecureContext) {
    return `Running code needs cross-origin isolation, which works only on HTTPS or localhost, and this page is on neither. ${STILL_EDIT}`;
  }
  if (page.embedded) {
    return `Running code needs cross-origin isolation, which this page does not get inside another site's frame. Open it in a tab of its own. ${STILL_EDIT}`;
  }
  return `Running code needs cross-origin isolation, and this page was loaded without the headers that turn it on (Cross-Origin-Opener-Policy and Cross-Origin-Embedder-Policy). ${STILL_EDIT}`;
}

export function runtimeSupport(input: PageIsolation & { userAgent: string }): RuntimeSupport {
  const problem = isolationProblem(input);
  if (problem !== null) return { kind: 'unsupported', message: problem };
  switch (browserFamily(input.userAgent)) {
    case 'chromium':
      return { kind: 'supported' };
    case 'firefox':
      return {
        kind: 'limited',
        message: `Running code in Firefox is experimental, and the preview may not load. ${BEST}`,
      };
    case 'safari':
      return {
        kind: 'limited',
        message: `Running code in Safari is in beta and needs Safari 16.4 or later. ${BEST}`,
      };
    case 'other':
      return {
        kind: 'limited',
        message: `This browser has not been tested for running code. ${BEST}`,
      };
  }
}
