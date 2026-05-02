import { WORKSPACE_ACCESS_DENIED_MESSAGE } from '@/lib/accounts';

export default function AccessDeniedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950 px-6 py-10 text-white">
      <section className="w-full max-w-md rounded-lg border border-gray-800 bg-gray-900/70 p-6 shadow-2xl shadow-black/30">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.24em] text-cyan-300">
          Private beta
        </p>
        <h1 className="mb-3 text-3xl font-black tracking-normal text-white">
          Access denied
        </h1>
        <p className="text-sm leading-6 text-gray-400">{WORKSPACE_ACCESS_DENIED_MESSAGE}</p>
        <form action="/auth/logout" method="post" className="mt-6">
          <button className="rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold text-gray-200 transition hover:border-red-400 hover:text-red-200">
            Logout
          </button>
        </form>
      </section>
    </main>
  );
}
