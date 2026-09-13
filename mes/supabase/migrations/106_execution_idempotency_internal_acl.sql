-- Internal execution helpers must not remain directly callable by authenticated clients.
-- Migration 105 renamed the public RPCs into private helpers; PostgreSQL function ACLs
-- survive a rename, so explicitly remove authenticated EXECUTE from those helpers.

revoke execute on function mes_record_production_result_impl_v104(
  text, numeric, numeric, jsonb, text, timestamptz, text
) from public, anon, authenticated;

revoke execute on function mes_submit_quality_inspection_impl_v102(
  text, text, numeric, numeric, text, text, timestamptz, text
) from public, anon, authenticated;
