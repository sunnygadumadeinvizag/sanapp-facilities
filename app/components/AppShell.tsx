import type { ReactNode } from "react";
import { cookies } from "next/headers";
import {
  AppsMenu,
  getPlatformNav,
  lookupAppName,
  PageShell,
  SessionGuard,
  UserMenu,
} from "sanapp-common-ui";
import type { AppUserSession } from "@/lib/session";
import { verifyAppSession } from "@/lib/session";
import { roleLabel } from "@/lib/labels";

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "http://localhost:3000";
const MAIN_BASE_URL = process.env.MAIN_BASE_URL ?? "http://localhost:3001";

/** A sidebar entry — either a link, or a non-clickable section heading. */
export type SidebarItem = { label: string; href?: string; active?: boolean; heading?: boolean };

export async function AppShell({
  me,
  active = "home",
  children,
}: {
  me: AppUserSession;
  active?:
    | "home"
    | "my-bookings"
    | "admin"
    | "admin-buildings"
    | "admin-facilities"
    | "admin-bookings"
    | "my-apps"
    | "applications"
    | "account"
    | "notifications";
  children: ReactNode;
}) {
  const ssoRole =
    (await verifyAppSession((await cookies()).get("app4_session")?.value ?? ""))?.ssoRole ??
    "USER";
  const isSuperAdmin = ssoRole === "SUPER_ADMIN";
  const isAdmin = me.role === "ADMIN" || isSuperAdmin;

  const appName = await lookupAppName({
    mainBaseUrl: MAIN_BASE_URL,
    appKey: process.env.MAIN_API_KEY,
    basePath: process.env.BASE_PATH ?? "/facilities",
    fallback: "Facilities",
  });

  // Keep one canonical navigation for every Facilities route. Pages only
  // provide the active key; they cannot accidentally replace the sidebar.
  const effectiveSidebar: SidebarItem[] = [
    { label: "Facilities Home", href: "/", active: active === "home" },
    { label: "My Bookings", href: "/my-bookings", active: active === "my-bookings" },
    // The app admin console — visible only to app admins (app ADMIN role
    // or a central SUPER_ADMIN).
    ...(isAdmin
      ? [
          { label: "App Admin Console", heading: true },
          { label: "Admin Overview", href: "/admin", active: active === "admin" },
          { label: "Buildings & POCs", href: "/admin/buildings", active: active === "admin-buildings" },
          { label: "Facilities & POCs", href: "/admin/facilities", active: active === "admin-facilities" },
          { label: "All Bookings", href: "/admin/all-bookings", active: active === "admin-bookings" },
        ]
      : []),
    { label: "App Notifications", href: "/notifications", active: active === "notifications" },
  ];

  const themeRes = await fetch(`${SSO_BASE_URL}/api/theme`, {
    cache: "no-store",
    signal: AbortSignal.timeout(2000),
  }).then((r) => r.json()).catch(() => ({}));
  const showAccount = !themeRes.accountDisplayDisabled || isSuperAdmin;

  return (
    <PageShell
      appName={appName}
      header={{
        navItems: getPlatformNav({
          mainBaseUrl: MAIN_BASE_URL,
          ssoBaseUrl: SSO_BASE_URL,
          homeLabel: "Facilities",
          active: active === "home" ? "home" : undefined,
        }),
        right: (
          <>
            <AppsMenu launcherHref={MAIN_BASE_URL} />
            <UserMenu
              name={me.name}
              email={me.email}
              role={isAdmin ? "App Admin" : roleLabel(me.role)}
              signOutHref="/api/logout"
            >
              {showAccount && <a href={`${SSO_BASE_URL}/account`}>My Account</a>}
              {isSuperAdmin && (
                <>
                  <div className="iipe-dropdown-section">Admin Console</div>
                  <a href={`${MAIN_BASE_URL}/admin-console`}>Admin Console</a>
                </>
              )}
            </UserMenu>
          </>
        ),
      }}
      sidebarItems={effectiveSidebar}
      footerLinks={[
        { label: "Facilities Home", href: "/" },
        { label: "My Bookings", href: "/my-bookings" },
        { label: "Notifications", href: "/notifications" },
      ]}
    >
      <SessionGuard channel="sanapp-facilities-session" />
      {children}
    </PageShell>
  );
}
