-- Row caps were removed from the product model. Results are streamed and
-- compressed instead of being artificially truncated.
DELETE FROM policies
WHERE rule_type = 'max_rows';
DELETE FROM custom_policies
WHERE kind = 'max_rows';
