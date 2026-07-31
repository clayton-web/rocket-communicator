-- Runs only on first volume init (empty data directory).
-- Development DB is POSTGRES_DB=prisma (created by the image).
-- Isolated test DB for future multi-connection / concurrency suites.

CREATE DATABASE prisma_test OWNER prisma;

GRANT ALL PRIVILEGES ON DATABASE prisma TO prisma;
GRANT ALL PRIVILEGES ON DATABASE prisma_test TO prisma;
