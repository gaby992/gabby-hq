# Inbox-IM module — setup

Adds three views to GabbyHQ for operating the n8n email-triage system:
`/inbox` (triage feed), `/chelsea` (Chelsea's daily list), `/rules` (rules engine).
Plus task due/start dates and "copy pending" lists.

## 1. Environment variables (Vercel → Settings → Environment Variables)

The inbox-IM data lives in a **separate** Supabase project. RLS is disabled on
those tables, so the service key is used and **all access is server-side only**
(API routes under `/api/inbox`, `/api/rules`). Never expose these to the client.

| Variable | Value |
| --- | --- |
| `SUPABASE_INBOXIM_URL` | `https://eldjacywdsnoqdcgdmad.supabase.co` |
| `SUPABASE_INBOXIM_SERVICE_KEY` | service_role key of the inbox-IM project |

For local dev, add the same two keys to `.env.local` (git-ignored).

The GabbyHQ project keeps using its existing `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_SECRET_SEED`,
`ADMIN_PASSWORD`.

## 2. Database migration (GabbyHQ Supabase only)

The inbox-IM tables (`im_triaje`, `im_reglas`) already exist — do **not** create them.

Only the GabbyHQ `tasks` table needs one new column for the due/start-date feature.
Run in the GabbyHQ Supabase SQL editor:

```sql
-- sql/2026-07-add-task-start-date.sql
alter table tasks add column if not exists start_date date;
```

(`due_date` already exists.)

## Auth

The inbox/rules API routes are guarded by the existing session cookie
(`ghq_session`) via `src/lib/session.ts` — the middleware lets `/api/*` through,
so these routes validate the cookie themselves. Only Gabby's logged-in session
can reach the data; there is no separate Chelsea login.

## Row actions (mirror the Telegram buttons)

| Action | Writes |
| --- | --- |
| For Chelsea | `status=pasado_a_chelsea, asignado_a=Chelsea, decidido_at=now()` |
| I'll handle it | `status=lo_resuelvo_yo, asignado_a=Gabby, decidido_at=now()` |
| Archive | `status=archivado, decidido_at=now()` (does not touch Gmail) |
| Done | `status=resuelto, resuelto_at=now()` |
