-- Existing events retain their explicit setting; only new rows default to disabled.
ALTER TABLE "Event" ALTER COLUMN "locationEnabled" SET DEFAULT false;
