/**
 * People paste whatever they were sent: a bare ID, a workspace link, or an old
 * /room/ link. All three should work.
 */
import { projectIdSchema } from '@collabcode/shared';

export function projectIdFromInput(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const direct = projectIdSchema.safeParse(trimmed);
  if (direct.success) return direct.data;

  try {
    const segments = new URL(trimmed).pathname.split('/').filter((part) => part !== '');
    const fromUrl = projectIdSchema.safeParse(segments.at(-1));
    return fromUrl.success ? fromUrl.data : null;
  } catch {
    return null;
  }
}
