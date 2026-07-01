import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  useRouterState,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppLayout } from "../components/AppLayout";
import { ProtectedRoute } from "@/auth/protectedRoute";
import { logout } from "@/services/authService";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <p className="mt-2 text-sm text-muted-foreground">Route not found in BELTrak.</p>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">This page didn't load</h1>
        <button
          onClick={() => { router.invalidate(); reset(); }}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Try again
        </button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "BELTrak — Airport Suspect Baggage Tracking" },
      { name: "description", content: "BELTrak airport suspect baggage tracking and customs control system." },
      { property: "og:title", content: "BELTrak — Airport Suspect Baggage Tracking" },
      { name: "twitter:title", content: "BELTrak — Airport Suspect Baggage Tracking" },
      { property: "og:description", content: "BELTrak airport suspect baggage tracking and customs control system." },
      { name: "twitter:description", content: "BELTrak airport suspect baggage tracking and customs control system." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a1639b51-d1fe-4a17-b9bf-f39c18350bc0/id-preview-66e11157--d2d7fa7a-0b69-4bcb-b602-f58ca026bad6.lovable.app-1781723326100.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/a1639b51-d1fe-4a17-b9bf-f39c18350bc0/id-preview-66e11157--d2d7fa7a-0b69-4bcb-b602-f58ca026bad6.lovable.app-1781723326100.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const isAuthPage = pathname === "/login" || pathname === "/register";

  async function handleLogout() {
    await logout().catch(() => undefined);
    queryClient.removeQueries({ queryKey: ["auth", "session"] });
    navigate({ to: "/login", replace: true });
  }

  return (
    <QueryClientProvider client={queryClient}>
      {isAuthPage ? (
        <Outlet />
      ) : (
        <ProtectedRoute>
          {(session) => (
            <AppLayout currentUser={session.user} onLogout={handleLogout}>
              <Outlet />
            </AppLayout>
          )}
        </ProtectedRoute>
      )}
    </QueryClientProvider>
  );
}
