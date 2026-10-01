/** Who built it, and where to find more. */

export const FOOTER_LINKS = [
  { label: 'GitHub', href: 'https://github.com/DarshanPotnis/CollabEditor' },
  { label: 'Portfolio', href: 'https://darshan-portfolio-fawn.vercel.app' },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/darshan-potnis-9304a3218' },
] as const;

export function LandingFooter(): React.ReactElement {
  return (
    <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-zinc-800 pt-4 text-xs text-zinc-500">
      <span>Built by Darshan Potnis</span>
      <nav aria-label="Built by" className="flex gap-4">
        {FOOTER_LINKS.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-100"
          >
            {link.label}
          </a>
        ))}
      </nav>
    </footer>
  );
}
