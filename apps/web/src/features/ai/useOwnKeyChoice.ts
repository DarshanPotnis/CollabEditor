/**
 * Which of the person's own keys is in use, for the AI panel and its
 * settings. Only the provider and model enter React state: the key stays in
 * byok-store, and a request reads it from there at the moment it is sent.
 */
import { useCallback, useState } from 'react';
import type { ByokChoice } from '@collabcode/shared';
import {
  browserSessionStorage,
  changeOwnKeyModel,
  forgetOwnKey,
  ownKeyChoice,
  saveOwnKey,
  type OwnKey,
  type SaveOwnKeyResult,
} from './byok-store.js';

export type OwnKeySettings = {
  /** The saved key's provider and model, or null when the shared tier is in use. */
  choice: ByokChoice | null;
  save: (ownKey: OwnKey) => SaveOwnKeyResult;
  /** Another model for the saved key's provider, keeping the key. */
  changeModel: (choice: ByokChoice) => SaveOwnKeyResult;
  forget: () => void;
};

export function useOwnKeyChoice(): OwnKeySettings {
  const [storage] = useState(browserSessionStorage);
  const [choice, setChoice] = useState(() => ownKeyChoice(storage));

  const applied = useCallback((result: SaveOwnKeyResult): SaveOwnKeyResult => {
    if (result.ok) setChoice(result.choice);
    return result;
  }, []);

  const save = useCallback(
    (ownKey: OwnKey) => applied(saveOwnKey(storage, ownKey)),
    [applied, storage],
  );
  const changeModel = useCallback(
    (next: ByokChoice) => applied(changeOwnKeyModel(storage, next)),
    [applied, storage],
  );
  const forget = useCallback(() => {
    forgetOwnKey(storage);
    setChoice(null);
  }, [storage]);

  return { choice, save, changeModel, forget };
}
