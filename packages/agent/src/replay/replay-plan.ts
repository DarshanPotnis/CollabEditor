/**
 * Whether a recorded session can be replayed as a demo on a given project,
 * and what a replay of it shows before it starts. A demo replays a session
 * that finished, whose every step the model answered, from the same template
 * and the same starting files: the recorded answers were written for those
 * files, so on any others they would not fit.
 */
import type { AgentTrace } from '../trace.js';

export type ReplayPlan =
  | {
      ok: true;
      goal: string;
      /** Milliseconds since the epoch. */
      recordedAt: number;
      /** "agent@5", or null when the recording did not say. */
      prompt: string | null;
      model: { provider: string; id: string } | null;
      steps: number;
    }
  | { ok: false; reason: string };

export function planReplay(trace: AgentTrace, project: AgentTrace['project']): ReplayPlan {
  if (trace.outcome?.kind !== 'finished') {
    return {
      ok: false,
      reason: 'This recording did not end with the AI finishing, so it cannot be played as a demo.',
    };
  }
  const unanswered = trace.steps.find((step) => step.model === null);
  if (unanswered) {
    return {
      ok: false,
      reason: `The model did not answer step ${String(unanswered.index)} of this recording, so it cannot be played as a demo.`,
    };
  }
  if (trace.project.template !== project.template) {
    return {
      ok: false,
      reason: `This recording was made on the ${trace.project.template ?? 'unknown'} template, and this project is ${project.template ?? 'not from a template'}.`,
    };
  }
  if (trace.project.filesFingerprint !== project.filesFingerprint) {
    return {
      ok: false,
      reason:
        'This project does not have the files the recording started with: a file was changed before the replay began, or the template has changed since it was recorded (then the recording needs making again).',
    };
  }
  const model = trace.steps[0]?.model ?? null;
  return {
    ok: true,
    goal: trace.inputs.goal,
    recordedAt: trace.startedAt,
    prompt: trace.prompt === null ? null : `${trace.prompt.id}@${String(trace.prompt.version)}`,
    model: model === null ? null : { provider: model.provider, id: model.id },
    steps: trace.steps.length,
  };
}
