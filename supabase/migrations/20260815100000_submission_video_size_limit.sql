-- ---------------------------------------------------------------------------
-- Round submissions: raise the Storage ceiling to 250MB for video
-- deliverables (§9.1 sets no application-level cap).
--
-- Rounds may now be submitted as a recording (mp4/mov/webm/m4v/mkv), and
-- 50MB — sized for a slide deck — is a few minutes of phone footage. The
-- bucket limit is per-object and type-blind, so it is raised to 250MB for
-- everything in "submissions"; the finer rule (250MB for video, 50MB for
-- documents) lives in src/app/app/rounds/[id]/actions.ts, which is the
-- allowlist's home already.
--
-- MIME stays unconstrained at the bucket level for the reason given in
-- migration 20260812120000: browsers report empty or vendor-specific types
-- often enough that a bucket allowlist would reject legitimate files.
-- ---------------------------------------------------------------------------

update storage.buckets
set file_size_limit = 262144000
where id = 'submissions';
