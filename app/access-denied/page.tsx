import { apiPath, Footer, getPlatformNav, Header, Logo } from "sanapp-common-ui";

export const dynamic = "force-dynamic";

const SSO_BASE_URL = process.env.SSO_BASE_URL ?? "http://localhost:3000";
const MAIN_BASE_URL = process.env.MAIN_BASE_URL ?? "http://localhost:3001";

const APP_NAME = "Facilities Booking";

export default function AccessDeniedPage() {
  return (
    <>
      <Header
        navItems={getPlatformNav({
          mainBaseUrl: MAIN_BASE_URL,
          ssoBaseUrl: SSO_BASE_URL,
          signedOut: true,
        })}
      />
      <div className="iipe-center-page">
        <div className="iipe-card" style={{ width: 440, maxWidth: "100%" }}>
          <Logo showText={false} />
          <h1 style={{ margin: "14px 0 4px", fontSize: "1.3rem" }}>Access denied</h1>
          <p style={{ marginTop: 8 }}>
            You don&apos;t have access to <strong>{APP_NAME}</strong>. Please contact the
            administrator if you believe this is a mistake.
          </p>
          <div className="iipe-alert">
            Application access is granted centrally in{" "}
            <a href={MAIN_BASE_URL}>IIPE Main</a>. Ask an administrator to grant you access,
            then <a href={apiPath("/")}>try again</a> — you won&apos;t need to sign in again.
          </div>
          <div className="iipe-form-actions">
            <a className="iipe-btn" href={MAIN_BASE_URL}>
              Go to My Apps
            </a>
            <a className="iipe-btn secondary" href={apiPath("/")}>
              Try again
            </a>
            <a className="iipe-btn ghost" href={apiPath("/api/logout")} style={{ color: "var(--iipe-danger)" }}>
              Sign out
            </a>
          </div>
        </div>
      </div>
      <Footer />
    </>
  );
}
