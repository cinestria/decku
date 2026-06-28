-- decku Realtime Authorization (테넌트 격리의 보안 경계)
--
-- 채널 토픽 형식: tenant:<namespace>:...  (sessions / tx:<sid> / cmd)
-- realtime 토큰의 JWT claim `namespace` 와 토픽의 namespace 세그먼트가 일치할 때만 read/write 허용.
-- 즉 namespace A 토큰으론 tenant:A:* 만, tenant:B:* 는 거부.
--
-- 적용: Supabase 대시보드 SQL Editor에 붙여넣기 (또는 supabase CLI db push).
-- 전제: 클라이언트는 채널을 private 로 구독해야 RLS가 적용됨.

-- realtime.messages 에 RLS 활성화 (Supabase 기본 활성이지만 명시)
alter table realtime.messages enable row level security;

-- 토픽이 우리 규칙(tenant:<namespace>:...)을 따르고 namespace가 토큰과 일치하는가
create or replace function public.decku_topic_allowed()
returns boolean
language sql
stable
as $$
  select
    split_part(realtime.topic(), ':', 1) = 'tenant'
    and split_part(realtime.topic(), ':', 2) = (auth.jwt() ->> 'namespace')
    and coalesce(auth.jwt() ->> 'namespace', '') <> '';
$$;

-- 수신(subscribe/broadcast receive)
drop policy if exists "decku tenant read" on realtime.messages;
create policy "decku tenant read"
on realtime.messages
for select
to authenticated
using ( public.decku_topic_allowed() );

-- 송신(broadcast send)
drop policy if exists "decku tenant write" on realtime.messages;
create policy "decku tenant write"
on realtime.messages
for insert
to authenticated
with check ( public.decku_topic_allowed() );
