import "dotenv/config";
import pg from "pg";
const { Client } = pg;

const FAC_DB = process.env.DATABASE_URL || "postgresql://app4_user:app4_dev_password@localhost:5432/sanapp_facilities_db";
const SSO_DB = "postgresql://sso_user:sso_dev_password@localhost:5432/sanapp_sso_db";

async function main() {
  const facClient = new Client({ connectionString: FAC_DB });
  const ssoClient = new Client({ connectionString: SSO_DB });

  await facClient.connect();
  await ssoClient.connect();

  console.log("Connected to databases.");

  const ssoUsersRes = await ssoClient.query('SELECT id, username, name, email, "primaryRole", role FROM "User"');
  console.log(`Found ${ssoUsersRes.rows.length} users in SSO.`);

  let updated = 0;
  for (const u of ssoUsersRes.rows) {
    const res = await facClient.query(
      'UPDATE "AppUser" SET "primaryRole" = $1, "ssoUserId" = $2, "name" = $3, "email" = $4 WHERE "username" = $5 RETURNING id, username, "primaryRole"',
      [u.primaryRole || null, u.id, u.name, u.email, u.username]
    );
    if (res.rowCount && res.rowCount > 0) {
      console.log(`Updated AppUser: ${u.username} -> primaryRole = ${u.primaryRole}`);
      updated++;
    }
  }

  console.log(`Finished syncing: ${updated} AppUsers updated.`);

  const cvrao = await facClient.query('SELECT id, username, name, role, "primaryRole" FROM "AppUser" WHERE "username" = $1', ['cvrao1972.cse']);
  console.log("cvrao1972.cse in Facilities DB:", cvrao.rows);

  await facClient.end();
  await ssoClient.end();
}

main().catch(err => {
  console.error("Sync error:", err);
  process.exit(1);
});
