-- =====================================================================
-- Caja del evento: el bloque BARRAS se suma solo desde los cajeros
--
-- Si el evento tiene cajeros, en la Caja:
--   efectivo real    = total retirado a todos los cajeros
--   efectivo sistema = suma del efectivo sistema de cada cajero
--   cierre de lotes  = suma del cierre de lotes de cada cajero
--   tarjetas sistema = suma de las tarjetas sistema de cada cajero
-- y se actualiza solo con cada cambio en Cajeros.
--
-- NO SE PIERDE NADA de lo ya cargado:
--   · Los eventos que ya tienen esos números cargados a mano los conservan
--     (barras_automatico = false). Se pueden pasar a automático desde la
--     Caja con "Usar el resumen de cajeros".
--   · Si se cargan a mano en un evento sin cajeros, también se respetan.
-- El resto de la Caja (boletería, guardarropas, gastos, cierre) no cambia.
-- =====================================================================

alter table public.evento_caja add column barras_automatico boolean not null default true;

-- Lo ya cargado a mano se respeta
update public.evento_caja
   set barras_automatico = false
 where coalesce(efectivo_real, efectivo_sistema, cierre_lotes, tarjetas_sistema) is not null;

-- Totales de todos los cajeros de un evento (vacío si no hay nada cargado)
create function public.totales_cajeros(
  p_evento uuid,
  out efectivo_real numeric, out efectivo_sistema numeric, out cierre_lotes numeric, out tarjetas_sistema numeric
)
language sql stable security definer set search_path = public as $$
  select (select sum(r.monto) from cajero_retiros r where r.evento_id = p_evento),
         sum(c.efectivo_sistema), sum(c.cierre_lotes), sum(c.tarjetas_sistema)
    from evento_cajeros c
   where c.evento_id = p_evento
$$;
revoke execute on function public.totales_cajeros(uuid) from public, anon, authenticated;

-- Al guardar la Caja: si es automática y hay cajeros, Barras se calcula (no se toma lo que venga)
create function public.caja_barras_desde_cajeros() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if exists (select 1 from evento_cajeros where evento_id = new.evento_id) then
    if new.barras_automatico then
      select * into t from totales_cajeros(new.evento_id);
      new.efectivo_real    := t.efectivo_real;
      new.efectivo_sistema := t.efectivo_sistema;
      new.cierre_lotes     := t.cierre_lotes;
      new.tarjetas_sistema := t.tarjetas_sistema;
    end if;
  elsif coalesce(new.efectivo_real, new.efectivo_sistema, new.cierre_lotes, new.tarjetas_sistema) is not null then
    -- Sin cajeros y con números cargados a mano: quedan a mano (si después se agregan cajeros, no se pisan)
    new.barras_automatico := false;
  end if;
  return new;
end $$;

create trigger caja_barras before insert or update on public.evento_caja
  for each row execute function public.caja_barras_desde_cajeros();

-- Cada cambio en Cajeros actualiza la Caja del evento
create function public.cajeros_actualizar_caja() returns trigger
language plpgsql security definer set search_path = public as $$
declare v uuid := coalesce(new.evento_id, old.evento_id);
begin
  -- El evento se está borrando: no hay nada que actualizar
  if not exists (select 1 from eventos where id = v) then return null; end if;

  if exists (select 1 from evento_cajeros where evento_id = v) then
    insert into evento_caja (evento_id, local_id)
    values (v, (select local_id from eventos where id = v))
    on conflict (evento_id) do update set barras_automatico = evento_caja.barras_automatico
     where evento_caja.barras_automatico;
  else
    -- Se borraron todos los cajeros: lo que se había sumado solo se vacía
    update evento_caja
       set efectivo_real = null, efectivo_sistema = null, cierre_lotes = null, tarjetas_sistema = null
     where evento_id = v and barras_automatico;
  end if;
  return null;
end $$;

create trigger actualizar_caja after insert or update or delete on public.evento_cajeros
  for each row execute function public.cajeros_actualizar_caja();
create trigger actualizar_caja after insert or update or delete on public.cajero_retiros
  for each row execute function public.cajeros_actualizar_caja();

-- Eventos que ya tienen cajeros y Barras vacía: se completa ahora con la suma
insert into public.evento_caja (evento_id, local_id)
select distinct c.evento_id, c.local_id from public.evento_cajeros c
on conflict (evento_id) do update set barras_automatico = evento_caja.barras_automatico
 where evento_caja.barras_automatico;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
