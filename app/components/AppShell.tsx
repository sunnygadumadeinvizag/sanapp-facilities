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
  active?: "home" | "my-apps" | "applications" | "account";
  sidebarItems: SidebarItem[];
  children: ReactNode;
}) {
  // The registry name for this deployment (one project can host several apps):
  // resolved from sanapp-main by base path, falling back to the project name.
  const ssoRole =
    (await verifyAppSession((await cookies()).get("app4_session")?.value ?? ""))?.ssoRole ??
    "USER";
  const isSuperAdmin = ssoRole === "SUPER_ADMIN";
  const appName = await lookupAppName({
    mainBaseUrl: MAIN_BASE_URL,
    appKey: process.env.MAIN_API_KEY,
    basePath: process.env.BASE_PATH ?? "/facilities",
    fallback: "Facilities",
  });
  return (
    <PageShell
      appName={appName}
      header={{
        navItems: getPlatformNav({
          mainBaseUrl: MAIN_BASE_URL,
          ssoBaseUrl: SSO_BASE_URL,
          homeLabel: "Facilities",
          active,
        }),
        right: (
          <>
            <AppsMenu launcherHref={MAIN_BASE_URL} />
            <UserMenu
              name={me.name}
              email={me.email}
              role={roleLabel(me.role)}
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
      sidebarItems={sidebarItems}
    >
      <SessionGuard channel="sanapp-facilities-session" />
      {children}
    </PageShell>
  );
}
