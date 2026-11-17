-- ACTUALIZACIÓN: resúmenes mensuales de la caja fuerte (no se borran).
-- IMPORTANTE: antes tiene que estar corrida la actualización de la caja fuerte (actualizacion-caja-fuerte.sql).
-- Pegalo en Supabase → SQL Editor → Run (una sola vez).

-- =====================================================================
-- Caja fuerte: resúmenes mensuales guardados (cierres).
-- Cuando termina un mes se guarda una copia fija con sus totales y cada
-- renglón. NO se pueden borrar (no hay política de borrado), así el
-- registro del mes queda aunque después se borre un evento.
-- Si algo del mes cambia después, se puede actualizar el cierre
-- (el valor anterior queda en el historial).
-- =====================================================================

create table public.caja_fuerte_cierres (
  id            uuid primary key default gen_random_uuid(),
  local_id      uuid not null references public.locales(id),
  anio          integer not null check (anio between 2000 and 2100),
  mes           integer not null check (mes between 1 and 12),
  saldo_inicial numeric(14, 2) not null,
  efectivo      numeric(14, 2) not null,
  gastos        numeric(14, 2) not null,
  retiros       numeric(14, 2) not null,
  ingresos      numeric(14, 2) not null,
  saldo_final   numeric(14, 2) not null,
  -- [{ clase, fecha, titulo, detalle, monto, saldo, evento_id, items: [{ detalle, monto }] }, ...]
  -- (items = el detalle de cada gasto del evento)
  renglones     jsonb not null default '[]'::jsonb check (jsonb_typeof(renglones) = 'array'),
  cerrado_por   uuid references public.perfiles(id) default auth.uid(),
  cerrado_en    timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (local_id, anio, mes)
);

create trigger cierres_actualizado_en before update on public.caja_fuerte_cierres
  for each row execute function public.tocar_actualizado_en();

alter table public.caja_fuerte_cierres enable row level security;
create policy "ver" on public.caja_fuerte_cierres
  for select to authenticated using (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'));
create policy "guardar" on public.caja_fuerte_cierres
  for insert to authenticated with check (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'));
create policy "actualizar" on public.caja_fuerte_cierres
  for update to authenticated
  using (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'))
  with check (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'));
-- Sin política de borrado: nadie puede borrar un resumen mensual.

-- Además, aunque alguien tuviera acceso total, no se puede borrar
create function public.no_borrar_cierres() returns trigger
language plpgsql as $$
begin
  raise exception 'Los resúmenes mensuales de la caja fuerte no se pueden borrar.' using errcode = 'P0001';
end $$;
create trigger no_borrar before delete on public.caja_fuerte_cierres
  for each row execute function public.no_borrar_cierres();

create trigger auditar after insert or update or delete on public.caja_fuerte_cierres
  for each row execute function public.registrar_auditoria();

-- La caja fuerte también trae el detalle de cada gasto (para guardarlo en el cierre)
drop function public.caja_fuerte_eventos(uuid);
create function public.caja_fuerte_eventos(p_local uuid)
returns table (evento_id uuid, fecha date, nombre text, archivado boolean, efectivo numeric, gastos numeric, gastos_detalle jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.fecha, e.nombre, e.archivado,
         coalesce(c.efectivo_real, 0) + coalesce(c.boleteria_efectivo, 0) + coalesce(c.guardarropas_efectivo, 0),
         coalesce((select sum(g.monto) from evento_gastos g where g.evento_id = e.id), 0),
         coalesce((select jsonb_agg(jsonb_build_object('detalle', g.detalle, 'monto', g.monto) order by g.hora)
                     from evento_gastos g where g.evento_id = e.id), '[]'::jsonb)
    from eventos e
    left join evento_caja c on c.evento_id = e.id
   where e.local_id = p_local
     and public.tiene_permiso(p_local, 'caja_fuerte.gestionar')
     and (c.evento_id is not null or exists (select 1 from evento_gastos g where g.evento_id = e.id))
   order by e.fecha, e.creado_en;
$$;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
