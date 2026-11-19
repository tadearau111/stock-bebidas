-- =====================================================================
-- Roles de la noche
--
-- * "Encargado de la noche" pasa a llamarse "Administrador de la noche".
-- * Rol nuevo "Encargado de depósito": ve el depósito y, en los eventos que
--   tiene asignados, solo ve y carga las BARRAS (no ve caja, gastos, cajeros,
--   costos, bebida abierta ni resumen).
-- * Dos permisos nuevos para separar lo que se ve dentro de un evento:
--     eventos.caja    → caja, gastos de la noche y cajeros
--     eventos.resumen → bebida abierta y resumen
--   Los roles que ya cargaban o gestionaban eventos los reciben, así que para
--   ellos no cambia nada. La base de datos también lo controla (no solo la pantalla).
-- =====================================================================

insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('eventos.caja',    'Eventos', 61, 'Ver y cargar la caja, los gastos de la noche y los cajeros de los eventos'),
  ('eventos.resumen', 'Eventos', 62, 'Ver y cargar la bebida abierta y ver el resumen de los eventos')
on conflict (codigo) do nothing;

-- Quien ya cargaba o gestionaba eventos sigue viendo todo como hasta ahora
insert into public.rol_permisos (rol_id, permiso_codigo)
select distinct rp.rol_id, p.codigo
  from public.rol_permisos rp
  cross join (values ('eventos.caja'), ('eventos.resumen')) as p(codigo)
 where rp.permiso_codigo in ('eventos.cargar', 'eventos.gestionar')
on conflict do nothing;

-- "Encargado de la noche" → "Administrador de la noche" (es un rol del sistema: se habilita el cambio solo acá)
alter table public.roles disable trigger proteger_roles_sistema;
update public.roles
   set nombre = 'Administrador de la noche',
       descripcion = 'Carga todo en los eventos asignados: barras, bebida abierta, caja, gastos y cajeros'
 where nombre = 'Encargado de la noche';
alter table public.roles enable trigger proteger_roles_sistema;

create or replace function public.proteger_roles_sistema() returns trigger
language plpgsql as $$
begin
  if old.es_sistema and (tg_op = 'DELETE' or new.nombre <> old.nombre or not new.es_sistema) then
    raise exception 'Los roles Administrador y Administrador de la noche no se pueden borrar ni renombrar.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

-- Rol nuevo: Encargado de depósito
insert into public.roles (nombre, descripcion, es_sistema) values
  ('Encargado de depósito', 'Ve el depósito y carga solo las barras (stock inicial, reposiciones, stock final y retiros) de los eventos asignados', false)
on conflict (nombre) do nothing;

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r
  cross join (values ('eventos.cargar'), ('deposito.ver')) as p(codigo)
 where r.nombre = 'Encargado de depósito'
on conflict do nothing;

-- Caja, gastos y cajeros: solo con eventos.caja · Bebida abierta: solo con eventos.resumen
drop policy "ver" on public.evento_caja;
drop policy "cargar" on public.evento_caja;
create policy "ver" on public.evento_caja for select to authenticated
  using (public.puede_ver_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));
create policy "cargar" on public.evento_caja for all to authenticated
  using (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'))
  with check (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));

drop policy "ver" on public.evento_gastos;
drop policy "cargar" on public.evento_gastos;
create policy "ver" on public.evento_gastos for select to authenticated
  using (public.puede_ver_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));
create policy "cargar" on public.evento_gastos for all to authenticated
  using (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'))
  with check (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));

drop policy "ver" on public.evento_cajeros;
drop policy "cargar" on public.evento_cajeros;
create policy "ver" on public.evento_cajeros for select to authenticated
  using (public.puede_ver_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));
create policy "cargar" on public.evento_cajeros for all to authenticated
  using (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'))
  with check (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));

drop policy "ver" on public.cajero_retiros;
drop policy "cargar" on public.cajero_retiros;
create policy "ver" on public.cajero_retiros for select to authenticated
  using (public.puede_ver_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));
create policy "cargar" on public.cajero_retiros for all to authenticated
  using (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'))
  with check (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.caja'));

drop policy "ver" on public.bebida_abierta;
drop policy "cargar" on public.bebida_abierta;
create policy "ver" on public.bebida_abierta for select to authenticated
  using (public.puede_ver_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.resumen'));
create policy "cargar" on public.bebida_abierta for all to authenticated
  using (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.resumen'))
  with check (public.puede_editar_evento(evento_id) and public.tiene_permiso(local_id, 'eventos.resumen'));

-- La papelera también controla esos permisos al borrar
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
      _papelera_parte('evento_gastos', cond_ev),
      _papelera_parte('evento_cajeros', cond_ev),
      _papelera_parte('cajero_retiros', cond_ev)
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
    v_ok := puede_editar_evento(v_evento) and tiene_permiso(v_local, 'eventos.resumen');
    v_titulo := 'Bebida abierta: ' || (case r.cuartos when 1 then '¼' when 2 then '½' when 3 then '¾' else 'entera' end) || ' de ' || r.articulo;
    v_datos := jsonb_build_array(_papelera_parte('bebida_abierta', format('id = %L', p_id)));
    v_tabla := 'bebida_abierta';

  when 'gasto' then
    select * into r from evento_gastos where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento) and tiene_permiso(v_local, 'eventos.caja');
    v_titulo := 'Gasto: ' || r.detalle;
    v_detalle := '$ ' || to_char(r.monto, 'FM999G999G990D00');
    v_datos := jsonb_build_array(_papelera_parte('evento_gastos', format('id = %L', p_id)));
    v_tabla := 'evento_gastos';

  when 'cajero' then
    select * into r from evento_cajeros where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento) and tiene_permiso(v_local, 'eventos.caja');
    v_titulo := 'Cajero: ' || r.nombre;
    v_detalle := 'Con sus retiros de la noche';
    v_datos := jsonb_build_array(
      _papelera_parte('evento_cajeros', format('id = %L', p_id)),
      _papelera_parte('cajero_retiros', format('cajero_id = %L', p_id))
    );
    v_tabla := 'evento_cajeros';

  when 'retiro_cajero' then
    select cr.*, c.nombre as cajero into r from cajero_retiros cr join evento_cajeros c on c.id = cr.cajero_id where cr.id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento) and tiene_permiso(v_local, 'eventos.caja');
    v_titulo := 'Retiro a cajero ' || r.cajero || ': $ ' || to_char(r.monto, 'FM999G999G990D00');
    v_detalle := 'Hora ' || to_char(r.hora at time zone 'America/Argentina/Buenos_Aires', 'HH24:MI') || coalesce(' · ' || r.notas, '');
    v_datos := jsonb_build_array(_papelera_parte('cajero_retiros', format('id = %L', p_id)));
    v_tabla := 'cajero_retiros';

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
    v_titulo := (case r.tipo when 'retiro' then 'Retiro de caja fuerte: ' when 'pago' then 'Pago de tareas: ' else 'Ingreso a caja fuerte: ' end)
                || '$ ' || to_char(r.monto, 'FM999G999G990D00');
    v_detalle := case when r.tipo = 'pago' then r.persona || ' · ' || r.detalle else r.detalle end;
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
