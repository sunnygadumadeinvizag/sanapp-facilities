import { cookies } from "next/headers";
import { apiPath, Footer, getPlatformNav, Header, Logo } from "sanapp-common-ui";
import { verifyAppSession } from "@/lib/session";
import { AppShell } from "./components/AppShell";

export const dynamic = "force-dynamic";

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "http://localhost:3000";
const MAIN_BASE_URL = process.env.MAIN_BASE_URL ?? "http://localhost:3001";

function NotFoundBody() {
  return (
    <div className="iipe-card">
      <h1 className="iipe-page-title">404 — Page not found</h1>
      <p className="iipe-page-sub">
        The page you are looking for does not exist or may have been moved.
      </p>
      <div className="iipe-form-actions">
        <a className="iipe-btn" href={apiPath("/")}>
          Back to Facilities Home
        </a>
        <a className="iipe-btn secondary" href={MAIN_BASE_URL}>
          Open My Apps
        </a>
      </div>
    </div>
  );
}

export default async function NotFoundPage() {
  const store = await cookies();
  const session = store.get("app4_session")?.value ?? "";
  const me = await verifyAppSession(session);

  if (!me) {
    return (
      <>
        <Header
          appName="Facilities"
          navItems={getPlatformNav({
            mainBaseUrl: MAIN_BASE_URL,
            ssoBaseUrl: SSO_BASE_URL,
            signedOut: true,
            homeLabel: "Facilities",
          })}
        />
        <div className="iipe-center-page">
          <NotFoundBody />
        </div>
        <Footer />
      </>
    );
  }

  return (
    <AppShell me={me} active="home">
      <NotFoundBody />
    </AppShell>
  );
}
