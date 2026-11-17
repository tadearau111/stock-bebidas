-- ACTUALIZACIÓN: archivar eventos. Pegalo en Supabase → SQL Editor → Run (una sola vez).

-- =====================================================================
-- Archivar eventos: salen de la lista principal pero NO se borran,
-- así el stock del depósito (que se calcula con lo consumido en todos
-- los eventos) no cambia. Se pueden desarchivar.
-- =====================================================================

alter table public.eventos add column archivado boolean not null default false;
alter table public.eventos add column archivado_en timestamptz;

create index eventos_activos on public.eventos (local_id, archivado, fecha desc);
