-- Migration — record_locks.locked_by must be nullable
--
-- auth.uid() is null for every RPC invoked via the service_role admin
-- client (it carries no user JWT, only the service_role claim) — a
-- pre-existing, already-shipped gap this project accepts elsewhere
-- (admin_save_score's entered_by, stage_adjustments.created_by, etc. are
-- all silently null in the same way). Those columns are nullable, so it's
-- a silent audit gap, not a crash. record_locks.locked_by was NOT NULL,
-- which turns the same gap into a hard failure on every single lock
-- acquisition — fix it to match the rest of the codebase's tolerance.
--
-- PRD references: AUC-13..16.

set search_path = public, extensions;

alter table public.record_locks alter column locked_by drop not null;
