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

export type SidebarItem = { label: string; href: string; active?: boolean };

export async function AppShell({
  me,
  active = "home",
  sidebarItems,
  children,
}: {
  me: AppUserSession;
  active?: "home" | "my-bookings" | "admin" | "my-apps" | "applications" | "account" | "notifications";
  sidebarItems?: SidebarItem[];
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

  const effectiveSidebar: SidebarItem[] = sidebarItems && sidebarItems.length > 0
    ? sidebarItems
    : [
        { label: "Facilities Home", href: "/", active: active === "home" },
        { label: "My Bookings", href: "/my-bookings", active: active === "my-bookings" },
        ...(isAdmin ? [{ label: "App Admin", href: "/admin", active: active === "admin" }] : []),
        { label: "App Notifications", href: "/notifications", active: active === "notifications" },
      ];

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
              <a href={`${SSO_BASE_URL}/account`}>My Account</a>
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
    >
      <SessionGuard channel="sanapp-facilities-session" />
      {children}
    </PageShell>
  );
}
