/**
 * What the preview iframe may do (PLAN.md §10.2, ADR 006). The preview shows
 * pages served by the running project, which anyone in the project can
 * write, so it gets only what a web app under development needs.
 *
 * Allowed, and why:
 * - allow-scripts: the pages run their own JavaScript.
 * - allow-same-origin: WebContainer serves previews through a service worker
 *   on the preview's own origin; an opaque (sandboxed) origin cannot be
 *   controlled by it, and the preview does not load. The frame is on a
 *   StackBlitz origin, never ours, so this does not let it reach our page:
 *   the classic escape (a same-origin frame removing its own sandbox) needs
 *   the frame to share our origin.
 * - allow-forms: apps submit forms.
 *
 * Not allowed: top navigation (the preview cannot replace the workspace),
 * popups, modal dialogs, downloads, pointer lock, presentation. No
 * permissions (camera, microphone, geolocation) are delegated either.
 *
 * Verified against a real WebContainer preview in Chromium (Phase 3): scripts
 * run and forms submit; `window.top.location = …` throws a SecurityError and
 * the workspace stays put; `window.open` is blocked; and with
 * allow-same-origin removed the preview does not load at all.
 */
export const PREVIEW_SANDBOX = 'allow-scripts allow-same-origin allow-forms';

/** A preview URL for a path on the running server. */
export function previewUrl(serverUrl: string, path: string): string | null {
  const trimmed = path.trim() === '' ? '/' : path.trim();
  if (!trimmed.startsWith('/') || /\s/.test(trimmed)) return null;
  try {
    const base = new URL(serverUrl);
    const url = new URL(trimmed, base);
    return url.origin === base.origin ? url.toString() : null;
  } catch {
    // An unparseable server URL or path: there is nothing safe to show.
    return null;
  }
}
