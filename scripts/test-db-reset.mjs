import {
  createPostgresHarness,
  postgresTestAvailability,
} from "../tests/postgres/postgresHarness.mjs";

const availability = postgresTestAvailability();
if (!availability.available) throw new Error(availability.reason);
const database = createPostgresHarness(availability.databaseUrl, {
  psqlPath: availability.psqlPath,
});
process.stdout.write(`Resetting disposable PostgreSQL ${database.target.summary}\n`);
await database.migrateClean();
process.stdout.write("Applied migrations 001-027 from a clean schema.\n");
