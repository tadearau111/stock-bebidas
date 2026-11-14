-- =====================================================================
-- Fase 1 · Esquema base: locales, usuarios, roles y permisos,
-- artículos, movimientos del depósito e historial de auditoría.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Locales (salones). Hoy hay uno solo; cada local tiene un depósito.
-- ---------------------------------------------------------------------
create table public.locales (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null check (length(trim(nombre)) > 0),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Permisos y roles (configurables, no fijos en el código)
-- ---------------------------------------------------------------------
create table public.permisos (
  codigo      text primary key,
  descripcion text not null,
  grupo       text not null,
  orden       int  not null default 0
);

create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique check (length(trim(nombre)) > 0),
  descripcion text,
  es_sistema  boolean not null default false,   -- los roles de sistema no se borran
  creado_en   timestamptz not null default now()
);

create table public.rol_permisos (
  rol_id         uuid not null references public.roles(id) on delete cascade,
  permiso_codigo text not null references public.permisos(codigo) on delete cascade,
  primary key (rol_id, permiso_codigo)
);

-- ---------------------------------------------------------------------
-- Perfiles (uno por usuario de Supabase Auth) y su pertenencia a locales
-- ---------------------------------------------------------------------
create table public.perfiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text not null,
  email      text,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now()
);

create table public.miembros (
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  local_id   uuid not null references public.locales(id) on delete cascade,
  rol_id     uuid not null references public.roles(id),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  primary key (usuario_id, local_id)
);

-- ---------------------------------------------------------------------
-- Artículos (siempre se cuentan en unidades; el hielo en bolsas)
-- ---------------------------------------------------------------------
create table public.articulos (
  id             uuid primary key default gen_random_uuid(),
  local_id       uuid not null references public.locales(id),
  nombre         text not null check (length(trim(nombre)) > 0),
  marca          text,
  tamano         text,
  unidad         text not null default 'unidad' check (unidad in ('unidad', 'bolsa')),
  stock_minimo   integer not null default 0 check (stock_minimo >= 0),
  precio_costo   numeric(12, 2) check (precio_costo >= 0),
  precio_venta   numeric(12, 2) check (precio_venta >= 0),
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create unique index articulos_nombre_unico
  on public.articulos (local_id, lower(trim(nombre)));

-- ---------------------------------------------------------------------
-- Movimientos del depósito. El stock NO se guarda como número suelto:
-- se calcula sumando estos movimientos (y, desde la Fase 2, restando
-- lo consumido en las barras de los eventos).
--   ingreso: compra (cantidad > 0)
--   ajuste:  corrección manual con motivo (cantidad positiva o negativa)
-- ---------------------------------------------------------------------
create table public.movimientos (
  id          uuid primary key default gen_random_uuid(),  -- el celular puede generarlo (sincronización sin conexión)
  local_id    uuid not null references public.locales(id),
  articulo_id uuid not null references public.articulos(id) on delete restrict,
  tipo        text not null check (tipo in ('ingreso', 'ajuste')),
  cantidad    integer not null check (cantidad <> 0),
  motivo      text,
  fecha       timestamptz not null default now(),
  creado_por  uuid references public.perfiles(id) default auth.uid(),
  creado_en   timestamptz not null default now(),
  constraint ingreso_positivo check (tipo <> 'ingreso' or cantidad > 0),
  constraint ajuste_con_motivo check (tipo <> 'ajuste' or length(trim(coalesce(motivo, ''))) > 0)
);

create index movimientos_articulo on public.movimientos (articulo_id);
create index movimientos_local_fecha on public.movimientos (local_id, fecha desc);

-- El local del movimiento siempre es el del artículo (evita inconsistencias)
create function public.movimientos_completar() returns trigger
language plpgsql as $$
begin
  select a.local_id into new.local_id from public.articulos a where a.id = new.articulo_id;
  if new.local_id is null then
    raise exception 'El artículo no existe';
  end if;
  return new;
end $$;

create trigger movimientos_completar
  before insert or update of articulo_id on public.movimientos
  for each row execute function public.movimientos_completar();

-- Fecha de última modificación de artículos
create function public.tocar_actualizado_en() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  return new;
end $$;

create trigger articulos_actualizado_en
  before update on public.articulos
  for each row execute function public.tocar_actualizado_en();

-- ---------------------------------------------------------------------
-- Stock calculado por artículo
-- ---------------------------------------------------------------------
create view public.stock_articulos with (security_invoker = true) as
select
  a.*,
  coalesce(m.total, 0)::integer                as stock_actual,
  coalesce(m.total, 0) < a.stock_minimo         as bajo_minimo,
  greatest(a.stock_minimo - coalesce(m.total, 0), 0)::integer as faltante,
  coalesce(m.cantidad_movimientos, 0)::integer  as cantidad_movimientos
from public.articulos a
left join (
  select articulo_id, sum(cantidad) as total, count(*) as cantidad_movimientos
  from public.movimientos
  group by articulo_id
) m on m.articulo_id = a.id;

-- ---------------------------------------------------------------------
-- Historial de auditoría: lo completa la base de datos sola.
-- cambios = { campo: { "antes": valor, "despues": valor } }
-- ---------------------------------------------------------------------
create table public.auditoria (
  id          bigint generated always as identity primary key,
  local_id    uuid,
  tabla       text not null,
  registro_id text not null,
  accion      text not null check (accion in ('alta', 'modificacion', 'baja')),
  cambios     jsonb not null,
  usuario_id  uuid default auth.uid(),
  fecha       timestamptz not null default now(),
  articulo_id uuid,
  evento_id   uuid
);

create index auditoria_fecha on public.auditoria (fecha desc);
create index auditoria_articulo on public.auditoria (articulo_id);
create index auditoria_usuario on public.auditoria (usuario_id);

create function public.registrar_auditoria() returns trigger
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
      return new;   -- no cambió nada relevante
    end if;
  elsif tg_op = 'INSERT' then
    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', null, 'despues', v)), '{}')
      into v_cambios
      from jsonb_each(v_new) as e(k, v)
     where k not in ('creado_en', 'actualizado_en');
  else
    select coalesce(jsonb_object_agg(k, jsonb_build_object('antes', v, 'despues', null)), '{}')
      into v_cambios
      from jsonb_each(v_old) as e(k, v)
     where k not in ('creado_en', 'actualizado_en');
  end if;

  insert into public.auditoria (local_id, tabla, registro_id, accion, cambios, articulo_id, evento_id)
  values (
    nullif(v_fila ->> 'local_id', '')::uuid,
    tg_table_name,
    coalesce(v_fila ->> 'id', ''),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'modificacion' else 'baja' end,
    v_cambios,
    case when tg_table_name = 'articulos' then (v_fila ->> 'id')::uuid
         else nullif(v_fila ->> 'articulo_id', '')::uuid end,
    nullif(v_fila ->> 'evento_id', '')::uuid
  );

  return coalesce(new, old);
end $$;

create trigger auditar_articulos
  after insert or update or delete on public.articulos
  for each row execute function public.registrar_auditoria();

create trigger auditar_movimientos
  after insert or update or delete on public.movimientos
  for each row execute function public.registrar_auditoria();
