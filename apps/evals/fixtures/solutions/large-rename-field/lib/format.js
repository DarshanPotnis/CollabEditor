/** A user as the API shows it. */
export function formatUser(user) {
  return { id: user.id, name: user.name, created: user.created };
}

/** A post as the API shows it. */
export function formatPost(post) {
  return { id: post.id, title: post.title, authorId: post.authorId, created: post.created };
}
