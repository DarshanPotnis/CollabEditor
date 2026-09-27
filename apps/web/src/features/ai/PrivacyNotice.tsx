/**
 * The one-time notice before the first AI request (docs/PLAN-AI.md §6.2). It
 * appears in the AI panel with the request waiting behind it; Continue sends
 * the request and the notice does not come back (privacy-consent.ts).
 */

export type PrivacyNoticeProps = {
  onAccept: () => void;
  onCancel: () => void;
};

export function PrivacyNotice({ onAccept, onCancel }: PrivacyNoticeProps): React.ReactElement {
  return (
    <section
      aria-labelledby="ai-privacy-title"
      className="rounded-md border border-amber-900/60 bg-amber-950/30 p-3 text-sm text-zinc-200"
    >
      <h3 id="ai-privacy-title" className="font-semibold text-amber-100">
        Before you use AI
      </h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-zinc-300">
        <li>
          Your request, with the code or terminal output it is about, goes through the CollabCode
          server to an AI provider.
        </li>
        <li>
          Without your own key it uses Google Gemini's free tier, and Google may use what you send
          to improve its products. Leave out secrets and code you cannot share.
        </li>
        <li>
          With your own key, set in AI settings, it goes to the provider you choose under your
          agreement with them.
        </li>
        <li>The CollabCode server does not store or log what you send.</li>
      </ul>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-zinc-700 px-3 py-1 text-xs hover:border-zinc-500"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAccept}
          className="rounded-md bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-white"
        >
          Continue
        </button>
      </div>
    </section>
  );
}
