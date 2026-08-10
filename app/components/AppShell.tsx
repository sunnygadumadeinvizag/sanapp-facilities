import type { ReactNode } from "react";
import {
  AppsMenu,
  getPlatformNav,
  PageShell,
  SessionGuard,
  UserMenu,
} from "iipe-common-ui";
import type { AppUserSession } from "@/lib/session";
import { roleLabel } from "@/lib/labels";

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "http://localhost:3000";
const MAIN_BASE_URL = process.env.MAIN_BASE_URL ?? "http://localhost:3001";

export type SidebarItem = { label: string; href: string; active?: boolean };

export function AppShell({
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
  return (
    <PageShell
      header={{
        navItems: getPlatformNav({
          mainBaseUrl: MAIN_BASE_URL,
          ssoBaseUrl: SSO_BASE_URL,
          homeLabel: "Facilities",
          active,
        }),
        right: (
          <>
            <AppsMenu launcherHref={`${MAIN_BASE_URL}/my-apps`} />
            <UserMenu
              name={me.name}
              email={me.email}
              role={roleLabel(me.role)}
              signOutHref="/api/logout"
            >
              <a href={`${SSO_BASE_URL}/account`}>My Account</a>
              <a href={`${MAIN_BASE_URL}/my-apps`}>My Apps</a>
            </UserMenu>
          </>
        ),
      }}
      sidebarItems={sidebarItems}
    >
      <SessionGuard channel="iipe-app4-session" />
      {children}
    </PageShell>
  );
}
