ALTER TABLE "user" ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE session ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE account ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE verification ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
ALTER TABLE two_factor ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
