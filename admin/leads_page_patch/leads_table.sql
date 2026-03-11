create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  first_name text,
  last_name text,
  company_name text,
  email text,
  phone text,
  address text,
  notes text,
  status text not null default 'new',
  source text not null default 'manual',
  payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists leads_company_id_created_at_idx
  on public.leads (company_id, created_at desc);

create index if not exists leads_company_id_status_idx
  on public.leads (company_id, status);

alter table public.leads enable row level security;

drop policy if exists leads_select_company_members on public.leads;
create policy leads_select_company_members
  on public.leads
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.company_members cm
      where cm.company_id = leads.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists leads_insert_company_members on public.leads;
create policy leads_insert_company_members
  on public.leads
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.company_members cm
      where cm.company_id = leads.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists leads_update_company_members on public.leads;
create policy leads_update_company_members
  on public.leads
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.company_members cm
      where cm.company_id = leads.company_id
        and cm.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.company_members cm
      where cm.company_id = leads.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists leads_delete_company_members on public.leads;
create policy leads_delete_company_members
  on public.leads
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.company_members cm
      where cm.company_id = leads.company_id
        and cm.user_id = auth.uid()
    )
  );
