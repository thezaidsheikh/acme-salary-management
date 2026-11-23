// Thin bootstrap: build the app from the composition root and listen.
// No logic lives here, so it is excluded from coverage (see vitest.config.ts).
import "dotenv/config";
import { createApp } from "./app.js";
import { pool } from "./shared/db.js";
import { maybeSeedOnStart } from "./shared/seedOnStart.js";

const port = Number(process.env.PORT ?? 4000);
const app = createApp();
app.listen(port, () => {
  console.log(`Salary Management API listening on http://localhost:${port}`);
  // Seed in the background AFTER listening, so the first health check is
  // never delayed by a slow seed (10,000 rows). SEED_ON_START=true only
  // seeds an empty table — it skips at 10,000 and refuses any other
  // non-zero count — and a failure is logged, never fatal: the server
  // keeps serving. See src/shared/seedOnStart.ts and docs/DEPLOYMENT.md.
  void maybeSeedOnStart(pool);
});
