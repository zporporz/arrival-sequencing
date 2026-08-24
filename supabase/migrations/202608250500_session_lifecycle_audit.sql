-- Track each signed application session from successful IVAO login until it is
-- signed out, idle, or reaches its absolute expiry.

alter table public.ivao_login_audit
  add column if not exists session_id uuid,
  add column if not exists last_activity_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists logged_out_at timestamptz,
  add column if not exists end_reason text;

alter table public.ivao_login_audit
  drop constraint if exists ivao_login_audit_end_reason_check;
alter table public.ivao_login_audit
  add constraint ivao_login_audit_end_reason_check
  check (end_reason is null or end_reason in ('SIGN_OUT', 'IDLE', 'EXPIRED'));

create unique index if not exists ivao_login_audit_session_id_idx
  on public.ivao_login_audit (session_id)
  where session_id is not null;

create index if not exists ivao_login_audit_active_idx
  on public.ivao_login_audit (logged_out_at, expires_at)
  where session_id is not null;
