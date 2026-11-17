-- =====================================================================
-- Caja fuerte: el efectivo que queda después de cada evento.
--
-- Se arma sola con la caja de cada evento:
--   + Efectivo real (barras + boletería + guardarropas)
--   − Gastos de la noche (el total; el detalle queda en el evento)
-- y se le suman/restan los movimientos manuales:
--   − Retiro (con detalle: quién retiró, gastos del salón, etc.)
--   + Ingreso manual (ej: el saldo que ya había al empezar)
-- =====================================================================

insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('caja_fuerte.gestionar', 'Caja fuerte', 96, 'Ver la caja fuerte y cargar retiros e ingresos');
-- (el Administrador lo recibe solo)

create table public.caja_fuerte_movimientos (
  id         uuid primary key default gen_random_uuid(),
  local_id   uuid not null references public.locales(id),
  tipo       text not null check (tipo in ('retiro', 'ingreso')),
  monto      numeric(14, 2) not null check (monto > 0),
  detalle    text not null check (length(trim(detalle)) > 0),
  fecha      timestamptz not null default now(),
  creado_por uuid references public.perfiles(id) default auth.uid(),
  creado_en  timestamptz not null default now()
);
create index caja_fuerte_local_fecha on public.caja_fuerte_movimientos (local_id, fecha);

alter table public.caja_fuerte_movimientos enable row level security;
create policy "ver" on public.caja_fuerte_movimientos
  for select to authenticated using (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'));
create policy "cargar" on public.caja_fuerte_movimientos
  for all to authenticated
  using (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'))
  with check (public.tiene_permiso(local_id, 'caja_fuerte.gestionar'));

create trigger auditar after insert or update or delete on public.caja_fuerte_movimientos
  for each row execute function public.registrar_auditoria();

-- Lo que aporta cada evento a la caja fuerte (se recalcula solo)
create function public.caja_fuerte_eventos(p_local uuid)
returns table (evento_id uuid, fecha date, nombre text, archivado boolean, efectivo numeric, gastos numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.fecha, e.nombre, e.archivado,
         coalesce(c.efectivo_real, 0) + coalesce(c.boleteria_efectivo, 0) + coalesce(c.guardarropas_efectivo, 0),
         coalesce((select sum(g.monto) from evento_gastos g where g.evento_id = e.id), 0)
    from eventos e
    left join evento_caja c on c.evento_id = e.id
   where e.local_id = p_local
     and public.tiene_permiso(p_local, 'caja_fuerte.gestionar')
     and (c.evento_id is not null or exists (select 1 from evento_gastos g where g.evento_id = e.id))
   order by e.fecha, e.creado_en;
$$;

-- La papelera también guarda los retiros/ingresos borrados
create or replace function public.mandar_a_papelera(p_tipo text, p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_local   uuid;
  v_evento  uuid;
  v_titulo  text;
  v_detalle text;
  v_datos   jsonb;
  v_ok      boolean := false;
  v_borrados int;
  v_nuevo   uuid;
  v_tabla   text;
  v_ev_nombre text;
  r         record;
  cond_ev   text;
begin
  case p_tipo
  when 'evento' then
    select * into r from eventos where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.id;
    v_ok := tiene_permiso(v_local, 'eventos.gestionar');
    v_titulo := r.nombre;
    v_detalle := 'Evento del ' || to_char(r.fecha, 'DD/MM/YYYY') || ' con todo lo cargado';
    cond_ev := format('evento_id = %L', p_id);
    v_datos := jsonb_build_array(
      _papelera_parte('eventos', format('id = %L', p_id)),
      _papelera_parte('evento_asignaciones', cond_ev),
      _papelera_parte('barras', cond_ev),
      _papelera_parte('barra_articulos', cond_ev),
      _papelera_parte('reposiciones', cond_ev),
      _papelera_parte('retiros', cond_ev),
      _papelera_parte('bebida_abierta', cond_ev),
      _papelera_parte('evento_caja', cond_ev),
      _papelera_parte('evento_gastos', cond_ev)
    );
    v_tabla := 'eventos';

  when 'barra' then
    select b.*, e.nombre as evento_nombre into r from barras b join eventos e on e.id = b.evento_id where b.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := tiene_permiso(v_local, 'eventos.gestionar');
    v_titulo := r.nombre;
    v_detalle := 'Barra con sus artículos, reposiciones y retiros';
    v_datos := jsonb_build_array(
      _papelera_parte('barras', format('id = %L', p_id)),
      _papelera_parte('barra_articulos', format('barra_id = %L', p_id)),
      _papelera_parte('reposiciones', format('barra_articulo_id in (select id from barra_articulos where barra_id = %L)', p_id)),
      _papelera_parte('retiros', format('barra_id = %L', p_id))
    );
    v_tabla := 'barras';

  when 'linea' then
    select ba.*, a.nombre as articulo, b.nombre as barra into r
      from barra_articulos ba join articulos a on a.id = ba.articulo_id join barras b on b.id = ba.barra_id where ba.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
    v_titulo := r.articulo || ' (' || r.barra || ')';
    v_detalle := 'Artículo de barra: inicial ' || r.stock_inicial || coalesce(', final ' || r.stock_final, '');
    v_datos := jsonb_build_array(
      _papelera_parte('barra_articulos', format('id = %L', p_id)),
      _papelera_parte('reposiciones', format('barra_articulo_id = %L', p_id))
    );
    v_tabla := 'barra_articulos';

  when 'reposicion' then
    select rp.*, a.nombre as articulo into r from reposiciones rp join articulos a on a.id = rp.articulo_id where rp.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
    v_titulo := 'Reposición de ' || r.cantidad || ' ' || r.articulo;
    v_datos := jsonb_build_array(_papelera_parte('reposiciones', format('id = %L', p_id)));
    v_tabla := 'reposiciones';

  when 'retiro' then
    select rt.*, coalesce(a.nombre, t.nombre) as que into r
      from retiros rt left join articulos a on a.id = rt.articulo_id left join tragos t on t.id = rt.trago_id where rt.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
    v_titulo := (case r.tipo when 'personal' then 'Retiro de personal: ' else 'Cortesía: ' end) || r.cantidad || ' ' || r.que;
    v_detalle := 'Retiró: ' || r.retirado_por;
    v_datos := jsonb_build_array(_papelera_parte('retiros', format('id = %L', p_id)));
    v_tabla := 'retiros';

  when 'bebida_abierta' then
    select ba.*, a.nombre as articulo into r from bebida_abierta ba join articulos a on a.id = ba.articulo_id where ba.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
    v_titulo := 'Bebida abierta: ' || (case r.cuartos when 1 then '¼' when 2 then '½' when 3 then '¾' else 'entera' end) || ' de ' || r.articulo;
    v_datos := jsonb_build_array(_papelera_parte('bebida_abierta', format('id = %L', p_id)));
    v_tabla := 'bebida_abierta';

  when 'gasto' then
    select * into r from evento_gastos where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
    v_titulo := 'Gasto: ' || r.detalle;
    v_detalle := '$ ' || to_char(r.monto, 'FM999G999G990D00');
    v_datos := jsonb_build_array(_papelera_parte('evento_gastos', format('id = %L', p_id)));
    v_tabla := 'evento_gastos';

  when 'movimiento' then
    select m.*, a.nombre as articulo into r from movimientos m join articulos a on a.id = m.articulo_id where m.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id;
    v_ok := tiene_permiso(v_local, 'deposito.ajustar');
    v_titulo := (case r.tipo when 'ingreso' then 'Ingreso: ' else 'Ajuste: ' end) || r.cantidad || ' ' || r.articulo;
    v_detalle := 'Del ' || to_char(r.fecha at time zone 'America/Argentina/Buenos_Aires', 'DD/MM/YYYY HH24:MI') || coalesce(' · ' || r.motivo, '');
    v_datos := jsonb_build_array(_papelera_parte('movimientos', format('id = %L', p_id)));
    v_tabla := 'movimientos';

  when 'nota' then
    select * into r from notas_info where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id;
    v_ok := tiene_permiso(v_local, 'info.editar');
    v_titulo := 'Nota de Info: ' || r.titulo;
    v_detalle := 'Del ' || to_char(r.fecha, 'DD/MM/YYYY');
    v_datos := jsonb_build_array(_papelera_parte('notas_info', format('id = %L', p_id)));
    v_tabla := 'notas_info';

  when 'articulo' then
    select * into r from articulos where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id;
    v_ok := tiene_permiso(v_local, 'articulos.editar');
    v_titulo := 'Artículo: ' || r.nombre;
    v_datos := jsonb_build_array(_papelera_parte('articulos', format('id = %L', p_id)));
    v_tabla := 'articulos';

  when 'caja_fuerte' then
    select * into r from caja_fuerte_movimientos where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id;
    v_ok := tiene_permiso(v_local, 'caja_fuerte.gestionar');
    v_titulo := (case r.tipo when 'retiro' then 'Retiro de caja fuerte: ' else 'Ingreso a caja fuerte: ' end) || '$ ' || to_char(r.monto, 'FM999G999G990D00');
    v_detalle := r.detalle;
    v_datos := jsonb_build_array(_papelera_parte('caja_fuerte_movimientos', format('id = %L', p_id)));
    v_tabla := 'caja_fuerte_movimientos';

  else
    raise exception 'Tipo desconocido: %', p_tipo;
  end case;

  if not v_ok then
    raise exception 'No tenés permiso para borrar esto.' using errcode = '42501';
  end if;

  select nombre into v_ev_nombre from eventos where id = v_evento;

  -- Se borra (los hijos se van en cascada; ya están copiados en v_datos)
  execute format('delete from public.%I where id = $1', v_tabla) using p_id;
  get diagnostics v_borrados = row_count;
  if v_borrados = 0 then
    raise exception 'No se pudo borrar.' using errcode = 'P0001';
  end if;

  insert into papelera (local_id, tipo, registro_id, titulo, detalle, evento_id, evento_nombre, datos, borrado_por)
  values (v_local, p_tipo, p_id, v_titulo, v_detalle, v_evento, v_ev_nombre, v_datos, auth.uid())
  returning id into v_nuevo;
  return v_nuevo;
end $$;


revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
