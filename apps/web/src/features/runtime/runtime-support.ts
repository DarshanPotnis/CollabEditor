/**
 * Whether this browser can run the project, and what to tell the person.
 *
 * WebContainers need a cross-origin isolated page (SharedArrayBuffer). Given
 * that, StackBlitz supports Chromium browsers fully, Safari 16.4+ in beta and
 * Firefox in alpha (webcontainers.io/guides/browser-support). Editing never
 * depends on any of this.
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

export function runtimeSupport(input: {
  crossOriginIsolated: boolean;
  userAgent: string;
}): RuntimeSupport {
  if (!input.crossOriginIsolated) {
    return {
      kind: 'unsupported',
      message: `Running code needs a browser feature this page can't use here. You can still edit. ${BEST}`,
    };
  }
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
