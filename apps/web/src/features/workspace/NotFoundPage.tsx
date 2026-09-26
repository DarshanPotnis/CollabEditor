import { Link } from 'react-router-dom';

export function NotFoundPage(): React.ReactElement {
  return (
    <main className="flex h-full items-center justify-center p-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-medium tracking-wide text-zinc-500 uppercase">Not found</p>
        <h1 className="mt-2 text-2xl font-semibold">There is no project at this link</h1>
        <p className="mt-3 text-sm text-zinc-400">
          The link may be mistyped, or the project may never have existed. Projects are not deleted
          on their own.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-md bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-white"
        >
          Start a new project
        </Link>
      </div>
    </main>
  );
}
