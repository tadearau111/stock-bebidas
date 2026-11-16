-- ACTUALIZACIÓN FASE 2: pegalo en Supabase → SQL Editor → Run (una sola vez).

-- =====================================================================
-- Fase 2 · Eventos, barras, reposiciones, retiros y bebida abierta
--
-- Fórmula por barra y artículo:
--   Consumido = Stock inicial + Reposiciones − Stock final
-- Impacto en el depósito: sale el stock inicial y cada reposición,
-- vuelve el stock final. O sea, el depósito se descuenta por lo consumido.
-- Mientras no se carga el stock final, se considera que todo lo
-- llevado a la barra está afuera del depósito.
-- Los retiros y la bebida abierta NO tocan el depósito.
-- =====================================================================

create table public.eventos (
  id             uuid primary key default gen_random_uuid(),
  local_id       uuid not null references public.locales(id),
  fecha          date not null,
  nombre         text not null check (length(trim(nombre)) > 0),
  personas       integer not null default 0 check (personas >= 0),
  notas          text,
  creado_por     uuid references public.perfiles(id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index eventos_local_fecha on public.eventos (local_id, fecha desc);

create trigger eventos_actualizado_en
  before update on public.eventos
  for each row execute function public.tocar_actualizado_en();

-- Encargados asignados a cada evento
create table public.evento_asignaciones (
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  local_id   uuid not null references public.locales(id),
  creado_en  timestamptz not null default now(),
  primary key (evento_id, usuario_id)
);

create table public.barras (
  id        uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos(id) on delete cascade,
  local_id  uuid not null references public.locales(id),
  nombre    text not null check (length(trim(nombre)) > 0),
  orden     integer not null default 0,
  creado_en timestamptz not null default now()
);
create index barras_evento on public.barras (evento_id);

-- Qué artículos lleva cada barra y sus cantidades
create table public.barra_articulos (
  id            uuid primary key default gen_random_uuid(),
  barra_id      uuid not null references public.barras(id) on delete cascade,
  evento_id     uuid not null references public.eventos(id) on delete cascade,
  local_id      uuid not null references public.locales(id),
  articulo_id   uuid not null references public.articulos(id) on delete restrict,
  stock_inicial integer not null default 0 check (stock_inicial >= 0),
  stock_final   integer check (stock_final >= 0),   -- vacío = todavía no se contó
  creado_en     timestamptz not null default now(),
  unique (barra_id, articulo_id)
);
create index barra_articulos_articulo on public.barra_articulos (articulo_id);
create index barra_articulos_evento on public.barra_articulos (evento_id);

-- Reposiciones: 'detalle' (cada una durante la noche) o 'total' (un número de una)
create table public.reposiciones (
  id                uuid primary key default gen_random_uuid(),
  barra_articulo_id uuid not null references public.barra_articulos(id) on delete cascade,
  evento_id         uuid not null references public.eventos(id) on delete cascade,
  local_id          uuid not null references public.locales(id),
  articulo_id       uuid not null references public.articulos(id),
  tipo              text not null default 'detalle' check (tipo in ('detalle', 'total')),
  cantidad          integer not null check (cantidad > 0),
  hora              timestamptz not null default now(),
  creado_por        uuid references public.perfiles(id) default auth.uid(),
  creado_en         timestamptz not null default now()
);
create index reposiciones_linea on public.reposiciones (barra_articulo_id);

-- Retiros: consumo de personal y cortesías (salen de la barra, no del depósito)
create table public.retiros (
  id           uuid primary key default gen_random_uuid(),
  barra_id     uuid not null references public.barras(id) on delete cascade,
  evento_id    uuid not null references public.eventos(id) on delete cascade,
  local_id     uuid not null references public.locales(id),
  articulo_id  uuid not null references public.articulos(id),
  tipo         text not null check (tipo in ('personal', 'cortesia')),
  cantidad     integer not null check (cantidad > 0),
  retirado_por text not null check (length(trim(retirado_por)) > 0),
  hora         timestamptz not null default now(),
  creado_por   uuid references public.perfiles(id) default auth.uid(),
  creado_en    timestamptz not null default now()
);
create index retiros_barra on public.retiros (barra_id);

-- Bebida abierta: solo informativa. Se guarda en CUARTOS (1/4=1, 1/2=2, 3/4=3, entera=4)
create table public.bebida_abierta (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos(id) on delete cascade,
  local_id    uuid not null references public.locales(id),
  articulo_id uuid not null references public.articulos(id),
  cuartos     integer not null check (cuartos between 1 and 4),
  hora        timestamptz not null default now(),
  creado_por  uuid references public.perfiles(id) default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index bebida_abierta_evento on public.bebida_abierta (evento_id);

-- ---------------------------------------------------------------------
-- Completar local y evento desde el "padre" (evita datos cruzados)
-- ---------------------------------------------------------------------
create function public.completar_desde_evento() returns trigger
language plpgsql as $$
begin
  select e.local_id into new.local_id from public.eventos e where e.id = new.evento_id;
  if new.local_id is null then raise exception 'El evento no existe'; end if;
  return new;
end $$;

create function public.completar_desde_barra() returns trigger
language plpgsql as $$
begin
  select b.evento_id, b.local_id into new.evento_id, new.local_id from public.barras b where b.id = new.barra_id;
  if new.evento_id is null then raise exception 'La barra no existe'; end if;
  return new;
end $$;

create function public.completar_desde_linea() returns trigger
language plpgsql as $$
begin
  select ba.evento_id, ba.local_id, ba.articulo_id
    into new.evento_id, new.local_id, new.articulo_id
    from public.barra_articulos ba where ba.id = new.barra_articulo_id;
  if new.evento_id is null then raise exception 'La línea de barra no existe'; end if;
  return new;
end $$;

-- El artículo tiene que ser del mismo local que el evento
create function public.validar_articulo_del_local() returns trigger
language plpgsql as $$
begin
  if not exists (select 1 from public.articulos a where a.id = new.articulo_id and a.local_id = new.local_id) then
    raise exception 'El artículo no pertenece a este local';
  end if;
  return new;
end $$;

create trigger completar before insert or update of evento_id on public.evento_asignaciones
  for each row execute function public.completar_desde_evento();
create trigger completar before insert or update of evento_id on public.barras
  for each row execute function public.completar_desde_evento();
create trigger completar before insert or update of barra_id on public.barra_articulos
  for each row execute function public.completar_desde_barra();
create trigger validar_articulo before insert or update of articulo_id on public.barra_articulos
  for each row execute function public.validar_articulo_del_local();
create trigger completar before insert or update of barra_articulo_id on public.reposiciones
  for each row execute function public.completar_desde_linea();
create trigger completar before insert or update of barra_id on public.retiros
  for each row execute function public.completar_desde_barra();
create trigger validar_articulo before insert or update of articulo_id on public.retiros
  for each row execute function public.validar_articulo_del_local();
create trigger completar before insert or update of evento_id on public.bebida_abierta
  for each row execute function public.completar_desde_evento();
create trigger validar_articulo before insert or update of articulo_id on public.bebida_abierta
  for each row execute function public.validar_articulo_del_local();

-- ---------------------------------------------------------------------
-- Stock del depósito = ingresos + ajustes − consumido en barras
-- ---------------------------------------------------------------------
create view public.consumo_en_barras with (security_invoker = true) as
select
  ba.articulo_id,
  sum(ba.stock_inicial + coalesce(r.total, 0) - coalesce(ba.stock_final, 0))::integer as consumido
from public.barra_articulos ba
left join (
  select barra_articulo_id, sum(cantidad) as total from public.reposiciones group by barra_articulo_id
) r on r.barra_articulo_id = ba.id
group by ba.articulo_id;

create or replace view public.stock_articulos with (security_invoker = true) as
with stock as (
  select a.id,
         coalesce((select sum(m.cantidad) from public.movimientos m where m.articulo_id = a.id), 0)
         - coalesce((select c.consumido from public.consumo_en_barras c where c.articulo_id = a.id), 0) as total,
         (select count(*) from public.movimientos m where m.articulo_id = a.id)
         + (select count(*) from public.barra_articulos ba where ba.articulo_id = a.id) as usos
    from public.articulos a
)
select
  a.*,
  s.total::integer                              as stock_actual,
  s.total < a.stock_minimo                      as bajo_minimo,
  greatest(a.stock_minimo - s.total, 0)::integer as faltante,
  s.usos::integer                               as cantidad_movimientos
from public.articulos a
join stock s on s.id = a.id;

-- Stock por artículo para quien carga un evento (aunque no pueda ver el
-- depósito completo). Se usa para avisar si no alcanza.
create function public.stock_del_local(p_local uuid)
returns table (articulo_id uuid, stock_actual integer)
language sql stable security definer set search_path = public as $$
  select a.id,
         (coalesce((select sum(m.cantidad) from public.movimientos m where m.articulo_id = a.id), 0)
          - coalesce((select c.consumido from public.consumo_en_barras c where c.articulo_id = a.id), 0))::integer
    from public.articulos a
   where a.local_id = p_local and public.es_miembro(p_local);
$$;

-- ---------------------------------------------------------------------
-- Permisos sobre eventos
-- ---------------------------------------------------------------------
create function public.puede_ver_evento(p_evento uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.eventos e
     where e.id = p_evento
       and (
         public.tiene_permiso(e.local_id, 'eventos.gestionar')
         or (public.tiene_permiso(e.local_id, 'eventos.cargar')
             and exists (select 1 from public.evento_asignaciones a
                          where a.evento_id = e.id and a.usuario_id = auth.uid()))
       )
  );
$$;

-- Hoy ver y editar coinciden: quien ve un evento puede cargarle datos
-- (los eventos nunca se bloquean). Se deja separado por si cambia.
create function public.puede_editar_evento(p_evento uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.puede_ver_evento(p_evento);
$$;

alter table public.eventos             enable row level security;
alter table public.evento_asignaciones enable row level security;
alter table public.barras              enable row level security;
alter table public.barra_articulos     enable row level security;
alter table public.reposiciones        enable row level security;
alter table public.retiros             enable row level security;
alter table public.bebida_abierta      enable row level security;

-- (se chequea el permiso con el local de la fila: así funciona también
--  al crear el evento, cuando todavía no "existe" para la función)
create policy "ver eventos" on public.eventos
  for select to authenticated
  using (public.tiene_permiso(local_id, 'eventos.gestionar') or public.puede_ver_evento(id));
create policy "crear eventos" on public.eventos
  for insert to authenticated with check (public.tiene_permiso(local_id, 'eventos.gestionar'));
create policy "editar eventos" on public.eventos
  for update to authenticated
  using (public.tiene_permiso(local_id, 'eventos.gestionar'))
  with check (public.tiene_permiso(local_id, 'eventos.gestionar'));
create policy "borrar eventos" on public.eventos
  for delete to authenticated using (public.tiene_permiso(local_id, 'eventos.gestionar'));

create policy "ver asignaciones" on public.evento_asignaciones
  for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso(local_id, 'eventos.gestionar'));
create policy "gestionar asignaciones" on public.evento_asignaciones
  for all to authenticated
  using (public.tiene_permiso(local_id, 'usuarios.gestionar') or public.tiene_permiso(local_id, 'eventos.gestionar'))
  with check (public.tiene_permiso(local_id, 'usuarios.gestionar') or public.tiene_permiso(local_id, 'eventos.gestionar'));

-- Barras: quien carga el evento puede agregar y renombrar; borrar, solo quien gestiona
create policy "ver barras" on public.barras
  for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "crear barras" on public.barras
  for insert to authenticated with check (public.puede_editar_evento(evento_id));
create policy "editar barras" on public.barras
  for update to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "borrar barras" on public.barras
  for delete to authenticated using (public.tiene_permiso(local_id, 'eventos.gestionar'));

-- Datos cargados dentro del evento
create policy "ver" on public.barra_articulos for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.barra_articulos for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "ver" on public.reposiciones for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.reposiciones for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "ver" on public.retiros for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.retiros for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "ver" on public.bebida_abierta for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.bebida_abierta for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));

-- ---------------------------------------------------------------------
-- Historial: todo lo del evento queda registrado
-- ---------------------------------------------------------------------
create or replace function public.registrar_auditoria() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila    jsonb := coalesce(v_new, v_old);
  v_cambios jsonb := '{}'::jsonb;
  v_clave   text;
begin
  if tg_op = 'UPDATE' then
    for v_clave in select jsonb_object_keys(v_new) loop
      if v_clave in ('actualizado_en', 'creado_en')
         or (v_new -> v_clave) is not distinct from (v_old -> v_clave) then
        continue;
      end if;
      v_cambios := v_cambios || jsonb_build_object(
        v_clave, jsonb_build_object('antes', v_old -> v_clave, 'despues', v_new -> v_clave));
    end loop;
    if v_cambios = '{}'::jsonb then
      return new;
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', null, 'despues', v)), '{}')
      into v_cambios from jsonb_each(v_new) as e(k, v)
     where k not in ('creado_en', 'actualizado_en');
  else
    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', v, 'despues', null)), '{}')
      into v_cambios from jsonb_each(v_old) as e(k, v)
     where k not in ('creado_en', 'actualizado_en');
  end if;

  insert into public.auditoria (local_id, tabla, registro_id, accion, cambios, articulo_id, evento_id)
  values (
    nullif(v_fila ->> 'local_id', '')::uuid,
    tg_table_name,
    coalesce(v_fila ->> 'id', v_fila ->> 'evento_id', ''),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'modificacion' else 'baja' end,
    v_cambios,
    case when tg_table_name = 'articulos' then (v_fila ->> 'id')::uuid
         else nullif(v_fila ->> 'articulo_id', '')::uuid end,
    case when tg_table_name = 'eventos' then (v_fila ->> 'id')::uuid
         else nullif(v_fila ->> 'evento_id', '')::uuid end
  );
  return coalesce(new, old);
end $$;

create trigger auditar after insert or update or delete on public.eventos
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.evento_asignaciones
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.barras
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.barra_articulos
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.reposiciones
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.retiros
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.bebida_abierta
  for each row execute function public.registrar_auditoria();

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
