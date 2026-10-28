"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { api, clearAuth, dashboardPath, getToken, getUser, setUser, Role } from "../lib/api";

/**
 * Role-based page access. Renders its children only once the backend
 * (GET /api/auth/me) confirms the signed-in user has the page's role.
 * Signed-out visitors go to the login page; other roles go to their own
 * dashboard. The page's own data loading only starts after this check,
 * because the children don't mount before it.
 */
export default function RoleGate({ role, children }: { role: Role; children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      router.replace("/");
      return;
    }

    // The stored user is only a hint; the server's answer decides.
    const stored = getUser();
    if (stored?.role && stored.role !== role) {
      router.replace(dashboardPath(stored.role));
      return;
    }

    let cancelled = false;
    api
      .me()
      .then((me) => {
        if (cancelled) return;
        setUser({ ...stored, ...me });
        if (me.role !== role) router.replace(dashboardPath(me.role));
        else setAllowed(true);
      })
      .catch(() => {
        if (cancelled) return;
        clearAuth();
        router.replace("/");
      });
    return () => {
      cancelled = true;
    };
  }, [role, router]);

  if (!allowed) {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center" role="status">
        <span className="flex items-center gap-3 text-sm text-zinc-400">
          <span className="w-4 h-4 border-2 border-zinc-600 border-t-purple-400 rounded-full animate-spin" />
          Checking your access…
        </span>
      </div>
    );
  }
  return <>{children}</>;
}
