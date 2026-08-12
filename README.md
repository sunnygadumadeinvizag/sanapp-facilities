# IIPE Facilities Booking (iipe-app4)

An independent IIPE intranet application for booking institute facilities —
buildings, rooms and time slots. It follows the platform architecture:

- **Identity** — who you are → central SSO (`/sso`)
- **Application access** — can you use this app → IIPE Main (`/main`)
- **Role & business logic** — what you can do here → managed inside this app

It is a fully separate project with its own PostgreSQL database (`app4_db`),
own users, own roles and own business rules. It consumes `iipe-common-ui`
via a `file:` link (no private npm registry needed) and is built with a base
path (`/facilities`) so Apache2 can reverse-proxy it at `intranet.iipe.ac.in/facilities`.

## Booking model (all times IST)

- Slots are stored as a plain calendar date plus start/end minutes-from-midnight
  **Indian Standard Time** (UTC+5:30, fixed — no DST). The server derives the
  current IST time; the browser clock is never trusted.
- **Self-service** — 15 minutes up to 3 hours, any eligible user.
- **Approver (block for others)** — users with *approval access* can block a
  slot (15 min – 3 h) for another user, with a description and an optional
  PDF attachment (max 1 MB, stored in the DB).
- **POC (long)** — designated POCs can block slots **longer than 3 hours** on
  their own name, with a description and optional PDF.
- Overlapping confirmed bookings are rejected on the server.
- Facility eligibility is by SSO primary role
  (STAFF_TEACHING / STAFF_NON_TEACHING / STUDENT / SCHOLAR / GUEST) —
  an empty list means everyone.

## Roles inside the app

| Role | Capabilities |
| --- | --- |
| **App Admin** | manage buildings & facilities, set role eligibility, designate APPROVER/POC users, view/cancel all bookings, manage other admins |
| **Approver** | block slots ≤ 3 h for other users (description + PDF) |
| **POC** | block slots > 3 h on their own name (description + PDF) |
| **User** | self-service bookings (15 min – 3 h) |

## Local development

Requirements: Node 20+, pnpm, PostgreSQL on localhost:5432, and the sibling
repos `iipe-sso`, `iipe-main`, `iipe-common-ui` checked out next to this one.

```bash
pnpm install
cp .env.example .env          # fill in DB URL + secrets to match the SSO/Main seeds
npx prisma migrate deploy
npx prisma db seed
pnpm dev                      # http://localhost:3005 (basePath: set BASE_PATH=/facilities to test proxied)
```

The SSO seed registers the OIDC client `iipe-app4`; IIPE Main's seed registers
the application and grants. Sign in with any SSO user that has a Main grant
(e.g. `admin` / `admin123`).

## Deployment

See `deploy/VM-DEPLOYMENT.md` in the workspace root. App4 runs on port 3005
under pm2 with `BASE_PATH=/facilities`, and Apache2 proxies `/facilities` →
`http://127.0.0.1:3005/facilities`.
