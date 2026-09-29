/** The user to create from a request body, or the error to answer with. */
export function validateUser(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  if (name === '') return { error: 'name is required' };
  return { name, role: body?.role ?? 'member' };
}
