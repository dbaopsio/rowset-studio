-- Cap results at 10,000 rows by default so a stray SELECT cannot pull a
-- whole table into the editor. The policy is listed in My policies, where
-- it can be changed or turned off.
INSERT OR IGNORE INTO policies(id, org_id, name, rule_type, effect, enabled, config)
SELECT lower(hex(randomblob(16))), id, 'limit_rows', 'limit_rows', 'deny', 1, '10000' FROM organizations;
