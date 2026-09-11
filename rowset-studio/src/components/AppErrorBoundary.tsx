import { isRouteErrorResponse, useRouteError } from "react-router";
import { Button, Panel } from "./ui";

export default function AppErrorBoundary() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "The page could not be rendered.";

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 p-6 dark:bg-slate-950">
      <Panel className="w-full max-w-lg p-6">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Something went wrong</h1>
        <p className="mt-2 text-[13px] leading-5 text-slate-500 dark:text-slate-400">{message}</p>
        <div className="mt-5 flex gap-2">
          <Button onClick={() => window.location.reload()}>Reload page</Button>
          <button
            className="h-8 rounded px-3 text-[13px] text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
            onClick={() => { window.location.href = "/audit"; }}
          >
            Go to activity
          </button>
        </div>
      </Panel>
    </main>
  );
}
