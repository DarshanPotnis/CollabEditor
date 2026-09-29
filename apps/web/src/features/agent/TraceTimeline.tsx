/**
 * The trace viewer's timeline (trace-timeline.ts): the header, each step with
 * its model call and tool calls, and how it ended. A trace can come from a
 * file anyone made, so everything in it is shown as plain text, never through
 * the AI text renderer and never as HTML.
 */
import type { Timeline, TimelineStep } from './trace-timeline.js';

function Step({ step }: { step: TimelineStep }): React.ReactElement {
  return (
    <li className="space-y-1 border-l border-zinc-800 pl-2">
      <p className="text-xs text-zinc-300">
        <span className="font-semibold">Step {step.index}</span> · {step.model}
      </p>
      {step.waits.map((wait) => (
        <p key={wait} className="text-xs text-amber-200">
          {wait}
        </p>
      ))}
      {step.nudged && (
        <p className="text-xs text-zinc-500">It answered without a tool call and was nudged.</p>
      )}
      {step.reminder !== null && (
        <details className="text-xs">
          <summary className="cursor-pointer text-zinc-500">Reminder it was sent</summary>
          <pre className="mt-1 rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-400">
            {step.reminder}
          </pre>
        </details>
      )}
      {step.text !== null && (
        <pre className="rounded bg-zinc-950 p-2 text-xs whitespace-pre-wrap text-zinc-300">
          {step.text}
        </pre>
      )}
      <ul className="space-y-1" aria-label={`Tool calls in step ${String(step.index)}`}>
        {step.calls.map((call, index) => (
          <li key={index} className="text-xs">
            <details>
              <summary className="cursor-pointer text-zinc-300">
                {call.name}
                {call.isError && <span className="ml-1 text-amber-300">(did not work)</span>}
                <span className="ml-1 text-zinc-500">{call.duration}</span>
              </summary>
              <p className="mt-1 text-zinc-500">Input</p>
              <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-400">
                {call.input}
              </pre>
              <p className="mt-1 text-zinc-500">Output</p>
              <pre className="max-h-48 overflow-auto rounded bg-zinc-950 p-2 whitespace-pre-wrap text-zinc-400">
                {call.output === '' ? '(none)' : call.output}
              </pre>
            </details>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function TraceTimeline({ timeline }: { timeline: Timeline }): React.ReactElement {
  const { header, steps, end } = timeline;
  return (
    <div className="space-y-3" aria-label="Trace timeline">
      <div className="space-y-0.5 text-xs">
        <pre className="font-sans whitespace-pre-wrap text-zinc-200">{header.goal}</pre>
        {header.lines.map((line) => (
          <p key={line} className="text-zinc-500">
            {line}
          </p>
        ))}
      </div>
      <ol className="space-y-3" aria-label="Steps">
        {steps.map((step) => (
          <Step key={step.index} step={step} />
        ))}
      </ol>
      <div className="space-y-1 text-xs">
        <p className="font-semibold text-zinc-300">{end.outcome}</p>
        {end.summary !== null && (
          <pre className="font-sans whitespace-pre-wrap text-zinc-300">{end.summary}</pre>
        )}
        {end.checks === null ? (
          end.summary !== null && (
            <p className="text-zinc-500">Its checks were not recorded in this trace’s format.</p>
          )
        ) : (
          <>
            <ul aria-label="Checks it made" className="text-zinc-300">
              {end.checks.made.map((line) => (
                <li key={line}>✓ {line}</li>
              ))}
            </ul>
            {end.checks.notMade.length > 0 && (
              <ul aria-label="Checks it listed but did not make" className="text-amber-200">
                {end.checks.notMade.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
