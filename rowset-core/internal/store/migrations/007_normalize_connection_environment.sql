-- Connection environments are policy-bearing. Normalize common historical
-- labels so environment rules do not depend on exact operator spelling.
UPDATE connections
SET environment = 'prod'
WHERE lower(trim(environment)) IN ('prod', 'production', 'prd');

UPDATE connections
SET environment = 'dev'
WHERE lower(trim(environment)) IN ('dev', 'development', 'local', 'test');
