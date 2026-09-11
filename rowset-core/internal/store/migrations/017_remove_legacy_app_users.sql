-- App/service users were prototyped but never became part of the product.
-- Remove their dormant rows and collapse the identity model back to humans.
-- Migration 013 must remain immutable for databases that already applied it.
DROP INDEX IF EXISTS idx_users_org_username;

DELETE FROM user_roles
WHERE user_id IN (SELECT id FROM users WHERE user_type = 'app');

DELETE FROM refresh_tokens
WHERE user_id IN (SELECT id FROM users WHERE user_type = 'app');

DELETE FROM user_session_versions
WHERE user_id IN (SELECT id FROM users WHERE user_type = 'app');

DELETE FROM users WHERE user_type = 'app';

ALTER TABLE users DROP COLUMN username;
ALTER TABLE users DROP COLUMN user_type;
