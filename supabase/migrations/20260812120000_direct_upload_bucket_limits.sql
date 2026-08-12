-- ---------------------------------------------------------------------------
-- Direct browser → Storage uploads: bucket-level ceilings
--
-- File bytes used to travel through a Next.js Server Action, which meant
-- the app's real upload ceiling was `serverActions.bodySizeLimit` (1MB by
-- default) — every payment proof or round deck above that failed as an
-- unhandled 413 inside the action, i.e. a bare error boundary. Uploads now
-- go browser → Storage against a server-minted signed upload URL
-- (src/lib/uploads/direct-upload.ts).
--
-- Because the browser is the one writing the object, the size/MIME limits
-- can no longer live only in application code: this sets them on the
-- buckets themselves, so Storage rejects an over-limit or wrong-type
-- upload before it is ever stored. The app still re-reads the stored
-- object's real size and content type afterward and refuses to record a
-- row for anything that doesn't match — these are the outer guard, not the
-- only one.
--
-- No RLS change is needed: signed-upload tokens are validated by Storage
-- itself, so the anon browser client still has no insert policy on any of
-- these private buckets.
-- ---------------------------------------------------------------------------

-- REG-07: PDF/JPG/PNG payment proof, 10MB (the figure already surfaced to
-- teams by the register form's FileDrop).
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
where id = 'invoices';

-- §9.1 sets no application-level cap on submissions; 50MB is the
-- infrastructure ceiling, stated honestly rather than enforced silently
-- (ERR-02). MIME is deliberately not constrained here — the extension +
-- content-type allowlist stays in the action, because browsers report
-- empty or vendor-specific types for Office files often enough that a
-- bucket-level allowlist would reject legitimate decks.
update storage.buckets
set file_size_limit = 52428800
where id = 'submissions';

update storage.buckets
set file_size_limit = 52428800
where id = 'round-materials';
