-- Accounts created without a password the person chose (the desktop owner)
-- must set one before they can use Rowset Studio.
ALTER TABLE users ADD COLUMN password_required INTEGER NOT NULL DEFAULT 0;
