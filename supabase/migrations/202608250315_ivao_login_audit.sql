-- Successful IVAO OAuth login audit. This table is intentionally invisible to
-- browser Supabase roles; Thailand staff read it through /api/admin only.

create table if not exists public.ivao_login_audit (
  id bigint generated always as identity primary key,
  vid text not null,
  name text not null,
  public_nickname text,
  role text not null check (role in ('MEMBER', 'STAFF')),
  is_thailand_staff boolean not null default false,
  staff_positions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(staff_positions) = 'array'),
  division_id text,
  country_id text,
  atc_rating text,
  pilot_rating text,
  logged_in_at timestamptz not null default now()
);

create index if not exists ivao_login_audit_time_idx
  on public.ivao_login_audit (logged_in_at desc);
create index if not exists ivao_login_audit_vid_time_idx
  on public.ivao_login_audit (vid, logged_in_at desc);

alter table public.ivao_login_audit enable row level security;
revoke all privileges on public.ivao_login_audit from anon, authenticated;
grant all privileges on public.ivao_login_audit to service_role;
grant usage, select on sequence public.ivao_login_audit_id_seq to service_role;

comment on table public.ivao_login_audit is
  'Successful signed IVAO OAuth logins. Read access is restricted to the Thailand-staff backend API.';
