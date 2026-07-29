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
import printCss from "../styles/print.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppLayout } from "../components/AppLayout";
import { ProtectedRoute } from "@/auth/protectedRoute";
import { logout } from "@/services/authService";
import { Toaster } from "@/components/ui/sonner";
import { SessionProvider } from "@/auth/SessionContext";
import { PageErrorBoundary } from "@/components/PageErrorBoundary";
import { PermissionPageGate } from "@/components/RoleGate";

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
          onClick={() => {
            router.invalidate();
            reset();
          }}
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
      { title: "BELTrak — Operations Monitoring" },
      {
        name: "description",
        content: "BELTrak operations monitoring and baggage workflow console.",
      },
      { property: "og:title", content: "BELTrak — Operations Monitoring" },
      { name: "twitter:title", content: "BELTrak — Operations Monitoring" },
      {
        property: "og:description",
        content: "BELTrak operations monitoring and baggage workflow console.",
      },
      {
        name: "twitter:description",
        content: "BELTrak operations monitoring and baggage workflow console.",
      },
      { property: "og:image", content: "/images/beltcon-logo.jpeg" },
      { name: "twitter:image", content: "/images/beltcon-logo.jpeg" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "icon", href: "/images/beltcon-logo.jpeg" },
      { rel: "apple-touch-icon", href: "/images/beltcon-logo.jpeg" },
      { rel: "stylesheet", href: appCss },
      { rel: "stylesheet", href: printCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const isAuthPage =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/forgot-password" ||
    pathname === "/change-password";
  async function handleLogout() {
    await logout().catch(() => undefined);
    await queryClient.cancelQueries();
    // Operational query data is scoped to the authenticated session and must
    // never be handed to the next user of this browser.
    queryClient.clear();
    navigate({ to: "/login", replace: true });
  }

  return (
    <QueryClientProvider client={queryClient}>
      {isAuthPage ? (
        <Outlet />
      ) : (
        <ProtectedRoute>
          {(session) => (
            <SessionProvider session={session} onLogout={handleLogout}>
              <AppLayout session={session} onLogout={handleLogout}>
                <PermissionPageGate pathname={pathname} userPermissions={session.user.permissions}>
                  <PageErrorBoundary pageName="current">
                    <Outlet />
                  </PageErrorBoundary>
                </PermissionPageGate>
              </AppLayout>
            </SessionProvider>
          )}
        </ProtectedRoute>
      )}
      <Toaster position="top-right" richColors />
    </QueryClientProvider>
  );
}
