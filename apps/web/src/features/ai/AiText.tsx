/**
 * An AI answer as React elements: paragraphs with inline code, and code
 * blocks. Every piece of model output is a text child, so React escapes it;
 * nothing here takes HTML (ai-text-blocks.ts explains the format).
 */
import { useMemo } from 'react';
import { aiTextBlocks, type AiTextSpan } from './ai-text-blocks.js';

function Spans({ spans }: { spans: AiTextSpan[] }): React.ReactElement {
  return (
    <>
      {spans.map((span, index) =>
        span.kind === 'code' ? (
          <code key={index} className="rounded bg-zinc-800 px-1 py-0.5 font-mono text-[0.85em]">
            {span.text}
          </code>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  );
}

export function AiText({ text }: { text: string }): React.ReactElement {
  const blocks = useMemo(() => aiTextBlocks(text), [text]);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-zinc-200">
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index} className="whitespace-pre-wrap">
            <Spans spans={block.spans} />
          </p>
        ) : (
          <figure key={index} className="overflow-hidden rounded-md border border-zinc-800">
            {block.language !== '' && (
              <figcaption className="border-b border-zinc-800 px-2 py-1 font-mono text-[11px] text-zinc-500">
                {block.language}
              </figcaption>
            )}
            <pre className="overflow-x-auto bg-zinc-950 p-2 font-mono text-xs leading-snug">
              <code>{block.code}</code>
            </pre>
          </figure>
        ),
      )}
    </div>
  );
}
