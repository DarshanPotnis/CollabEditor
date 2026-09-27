/**
 * Writing the AI stream in server-sent events format: one `data:` line of JSON
 * per event. JSON.stringify escapes line breaks, so an event can never spill
 * onto a second line or forge another event, whatever text the model sends.
 */
import type { AiStreamEvent } from '@collabcode/shared';

export const SSE_HEADERS = {
  'content-type': 'text/event-stream; charset=utf-8',
  // no-transform asks proxies not to buffer or compress the stream.
  'cache-control': 'no-cache, no-transform',
  // The de facto way to ask nginx-style proxies to pass chunks straight on.
  'x-accel-buffering': 'no',
} as const;

export function encodeSseEvent(event: AiStreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}
