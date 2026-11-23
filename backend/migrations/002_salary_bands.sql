-- Salary bands — one row per level, monthly USD [min, mid, max].
-- Bands live in the database (not in code) so HR can change them without
-- a deploy. Values come from LEVEL_BANDS_USD in backend/src/seed/seedData.ts
-- (the same bands the seed uses to generate salaries); mid = (min+max)/2.
-- Runs AFTER 001_init.sql: it reuses the `level` enum created there, so
-- migrations must always be applied in numeric order (see scripts/migrate.ts).
--
-- IDEMPOTENT: safe to run more than once. The table uses IF NOT EXISTS,
-- the CHECKs only constrain the integer columns, and the seed rows use
-- ON CONFLICT (level) DO NOTHING, so a re-run inserts nothing new.
CREATE TABLE IF NOT EXISTS salary_bands (
  level level PRIMARY KEY,
  min_salary INTEGER NOT NULL CHECK (min_salary > 0),
  mid_salary INTEGER NOT NULL CHECK (mid_salary > min_salary),
  max_salary INTEGER NOT NULL CHECK (max_salary > mid_salary)
);
INSERT INTO salary_bands (level, min_salary, mid_salary, max_salary) VALUES
  ('Junior', 1500, 2000, 2500),
  ('Mid', 2500, 3500, 4500),
  ('Senior', 4500, 6000, 7500),
  ('Lead', 7500, 8750, 10000),
  ('Manager', 9000, 11000, 13000),
  ('Director', 12000, 15000, 18000)
ON CONFLICT (level) DO NOTHING;
