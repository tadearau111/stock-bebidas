-- ACTUALIZACIÓN: papelera de reciclaje (30 días). Pegalo en Supabase → SQL Editor → Run (una sola vez).

-- =====================================================================
-- Papelera de reciclaje
--
-- Lo que se borra a mano no desaparece: se guarda una copia completa
-- (con todo lo que depende de eso) durante 30 días. Desde la papelera
-- se puede restaurar (vuelve tal cual) o borrar definitivamente.
-- =====================================================================

insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('papelera.gestionar', 'Papelera', 95, 'Ver la papelera, restaurar y borrar definitivamente');
-- (el Administrador lo recibe solo)

create table public.papelera (
  id          uuid primary key default gen_random_uuid(),
  local_id    uuid not null references public.locales(id),
  tipo        text not null,
  registro_id uuid not null,
  titulo      text not null,
  detalle     text,
  evento_id   uuid,            -- sin FK: el evento puede estar borrado
  evento_nombre text,
  -- [{ "tabla": "eventos", "filas": [...] }, ...] en el orden en que se restauran
  datos       jsonb not null,
  borrado_por uuid references public.perfiles(id) on delete set null,
  borrado_en  timestamptz not null default now(),
  expira_en   timestamptz not null default now() + interval '30 days'
);
create index papelera_local on public.papelera (local_id, borrado_en desc);

alter table public.papelera enable row level security;
create policy "ver papelera" on public.papelera
  for select to authenticated using (public.tiene_permiso(local_id, 'papelera.gestionar'));
-- No hay políticas de escritura: solo se modifica con las funciones de abajo.

-- Copia de las filas de una tabla que cumplen una condición
create function public._papelera_parte(p_tabla text, p_condicion text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.%I t where %s', p_tabla, p_condicion) into v;
  return jsonb_build_object('tabla', p_tabla, 'filas', v);
end $$;
revoke execute on function public._papelera_parte(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Mandar a la papelera (reemplaza al "borrar" de la app)
-- ---------------------------------------------------------------------
create function public.mandar_a_papelera(p_tipo text, p_id uuid) returns uuid
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

-- ---------------------------------------------------------------------
-- Restaurar: vuelve a cargar todo tal cual estaba
-- ---------------------------------------------------------------------
create function public.restaurar_de_papelera(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  p     papelera%rowtype;
  parte jsonb;
begin
  select * into p from papelera where id = p_id;
  if not found then raise exception 'Ya no está en la papelera.' using errcode = 'P0001'; end if;
  if not tiene_permiso(p.local_id, 'papelera.gestionar') then
    raise exception 'No tenés permiso para restaurar.' using errcode = '42501';
  end if;

  begin
    for parte in select value from jsonb_array_elements(p.datos) loop
      if jsonb_array_length(parte -> 'filas') > 0 then
        execute format('insert into public.%I select * from jsonb_populate_recordset(null::public.%I, $1)', parte ->> 'tabla', parte ->> 'tabla')
          using parte -> 'filas';
      end if;
    end loop;
  exception
    when foreign_key_violation then
      raise exception 'No se puede restaurar porque se borró el evento, la barra o el artículo al que pertenecía. Restaurá eso primero.'
        using errcode = 'P0001';
    when raise_exception then
      -- los controles de "el evento / la barra / la línea no existe"
      if sqlerrm ilike '%no existe%' then
        raise exception 'No se puede restaurar porque se borró el evento, la barra o el artículo al que pertenecía. Restaurá eso primero.'
          using errcode = 'P0001';
      end if;
      raise;
    when unique_violation then
      raise exception 'No se puede restaurar porque ya existe uno igual (por ejemplo, un artículo con el mismo nombre).'
        using errcode = 'P0001';
  end;

  delete from papelera where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- Borrar definitivamente / vaciar / limpiar lo vencido
-- ---------------------------------------------------------------------
create function public.borrar_de_papelera(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_local uuid;
begin
  select local_id into v_local from papelera where id = p_id;
  if v_local is null then return; end if;
  if not tiene_permiso(v_local, 'papelera.gestionar') then
    raise exception 'No tenés permiso.' using errcode = '42501';
  end if;
  delete from papelera where id = p_id;
end $$;

create function public.vaciar_papelera(p_local uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not tiene_permiso(p_local, 'papelera.gestionar') then
    raise exception 'No tenés permiso.' using errcode = '42501';
  end if;
  delete from papelera where local_id = p_local;
end $$;

-- Lo que pasó los 30 días se borra solo (se ejecuta al abrir la papelera)
create function public.limpiar_papelera() returns void
language sql security definer set search_path = public as $$
  delete from public.papelera where expira_en < now();
$$;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
