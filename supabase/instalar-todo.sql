-- ARCHIVO GENERADO: une las migraciones de supabase/migrations en orden.
-- Pegalo completo en Supabase → SQL Editor → Run (una sola vez, en un proyecto nuevo).

-- ===== supabase/migrations/20261114000001_esquema.sql =====
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

-- ===== supabase/migrations/20261114000002_seguridad.sql =====
-- =====================================================================
-- Fase 1 · Seguridad (Row Level Security)
-- La base de datos decide quién puede ver y modificar cada cosa,
-- según los permisos del rol que el usuario tiene en cada local.
-- =====================================================================

-- ¿El usuario actual pertenece (activo) a este local?
create function public.es_miembro(p_local uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.miembros m
      join public.perfiles p on p.id = m.usuario_id
     where m.usuario_id = auth.uid()
       and m.local_id = p_local
       and m.activo and p.activo
  );
$$;

-- ¿El usuario actual tiene este permiso en este local?
create function public.tiene_permiso(p_local uuid, p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.miembros m
      join public.perfiles p on p.id = m.usuario_id
      join public.rol_permisos rp on rp.rol_id = m.rol_id
     where m.usuario_id = auth.uid()
       and m.local_id = p_local
       and m.activo and p.activo
       and rp.permiso_codigo = p_codigo
  );
$$;

-- ¿Tiene este permiso en algún local? (para cosas globales, como roles)
create function public.tiene_permiso_en_algun_local(p_codigo text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.miembros m
      join public.perfiles p on p.id = m.usuario_id
      join public.rol_permisos rp on rp.rol_id = m.rol_id
     where m.usuario_id = auth.uid()
       and m.activo and p.activo
       and rp.permiso_codigo = p_codigo
  );
$$;

-- ¿El usuario actual comparte algún local con este otro usuario?
create function public.comparte_local(p_usuario uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.miembros yo
      join public.miembros otro on otro.local_id = yo.local_id
     where yo.usuario_id = auth.uid() and yo.activo
       and otro.usuario_id = p_usuario
  );
$$;

-- Lo que necesita la app al iniciar: mis locales, mi rol y mis permisos
create function public.mi_acceso()
returns table (local_id uuid, local_nombre text, rol text, permisos text[])
language sql stable security definer set search_path = public as $$
  select l.id, l.nombre, r.nombre,
         coalesce(array_agg(rp.permiso_codigo order by rp.permiso_codigo)
                  filter (where rp.permiso_codigo is not null), '{}')
    from public.miembros m
    join public.perfiles p on p.id = m.usuario_id
    join public.locales l on l.id = m.local_id
    join public.roles r on r.id = m.rol_id
    left join public.rol_permisos rp on rp.rol_id = m.rol_id
   where m.usuario_id = auth.uid()
     and m.activo and p.activo and l.activo
   group by l.id, l.nombre, r.nombre
   order by l.nombre;
$$;

-- ---------------------------------------------------------------------
-- Alta automática de perfil. El PRIMER usuario que se crea queda como
-- Administrador del primer local (así arranca la administradora).
-- Los siguientes quedan sin acceso hasta que un administrador les dé un rol.
-- ---------------------------------------------------------------------
create function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_local uuid;
  v_rol   uuid;
begin
  insert into public.perfiles (id, nombre, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'nombre'), ''), split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;

  if not exists (select 1 from public.miembros) then
    select id into v_local from public.locales order by creado_en limit 1;
    select id into v_rol from public.roles where nombre = 'Administrador';
    if v_local is not null and v_rol is not null then
      insert into public.miembros (usuario_id, local_id, rol_id) values (new.id, v_local, v_rol);
    end if;
  end if;

  return new;
end $$;

create trigger al_crear_usuario
  after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------------------------------------------------------------------
-- Políticas
-- ---------------------------------------------------------------------
alter table public.locales      enable row level security;
alter table public.permisos     enable row level security;
alter table public.roles        enable row level security;
alter table public.rol_permisos enable row level security;
alter table public.perfiles     enable row level security;
alter table public.miembros     enable row level security;
alter table public.articulos    enable row level security;
alter table public.movimientos  enable row level security;
alter table public.auditoria    enable row level security;

-- Locales
create policy "ver mis locales" on public.locales
  for select to authenticated using (public.es_miembro(id));

-- Permisos y roles: cualquiera logueado los lee; editarlos requiere usuarios.gestionar
create policy "leer permisos" on public.permisos
  for select to authenticated using (true);
create policy "leer roles" on public.roles
  for select to authenticated using (true);
create policy "gestionar roles" on public.roles
  for all to authenticated
  using (public.tiene_permiso_en_algun_local('usuarios.gestionar'))
  with check (public.tiene_permiso_en_algun_local('usuarios.gestionar'));
create policy "leer permisos de roles" on public.rol_permisos
  for select to authenticated using (true);
create policy "gestionar permisos de roles" on public.rol_permisos
  for all to authenticated
  using (public.tiene_permiso_en_algun_local('usuarios.gestionar'))
  with check (public.tiene_permiso_en_algun_local('usuarios.gestionar'));

-- Perfiles: cada uno ve el suyo; quien gestiona usuarios ve todos
-- (los nombres de otros usuarios se exponen en el historial y en las cargas)
create policy "ver perfiles" on public.perfiles
  for select to authenticated
  using (id = auth.uid() or public.comparte_local(id));
create policy "gestionar perfiles" on public.perfiles
  for update to authenticated
  using (public.tiene_permiso_en_algun_local('usuarios.gestionar'))
  with check (public.tiene_permiso_en_algun_local('usuarios.gestionar'));

-- Miembros
create policy "ver miembros" on public.miembros
  for select to authenticated
  using (usuario_id = auth.uid() or public.tiene_permiso(local_id, 'usuarios.gestionar'));
create policy "gestionar miembros" on public.miembros
  for all to authenticated
  using (public.tiene_permiso(local_id, 'usuarios.gestionar'))
  with check (public.tiene_permiso(local_id, 'usuarios.gestionar'));

-- Artículos: todos los del local los ven (los necesitan para las barras);
-- crearlos, editarlos o borrarlos requiere articulos.editar.
-- Borrar solo funciona si no tienen historial (la base lo impide).
create policy "ver articulos" on public.articulos
  for select to authenticated using (public.es_miembro(local_id));
create policy "crear articulos" on public.articulos
  for insert to authenticated with check (public.tiene_permiso(local_id, 'articulos.editar'));
create policy "editar articulos" on public.articulos
  for update to authenticated
  using (public.tiene_permiso(local_id, 'articulos.editar'))
  with check (public.tiene_permiso(local_id, 'articulos.editar'));
create policy "borrar articulos" on public.articulos
  for delete to authenticated using (public.tiene_permiso(local_id, 'articulos.editar'));

-- Movimientos
create policy "ver movimientos" on public.movimientos
  for select to authenticated using (public.tiene_permiso(local_id, 'deposito.ver'));
create policy "cargar ingresos" on public.movimientos
  for insert to authenticated
  with check (
    creado_por = auth.uid()
    and (
      (tipo = 'ingreso' and public.tiene_permiso(local_id, 'ingresos.cargar'))
      or (tipo = 'ajuste' and public.tiene_permiso(local_id, 'deposito.ajustar'))
    )
  );
create policy "corregir movimientos" on public.movimientos
  for update to authenticated
  using (public.tiene_permiso(local_id, 'deposito.ajustar'))
  with check (public.tiene_permiso(local_id, 'deposito.ajustar'));
create policy "anular movimientos" on public.movimientos
  for delete to authenticated using (public.tiene_permiso(local_id, 'deposito.ajustar'));

-- Auditoría: solo lectura, y solo con permiso. Nadie puede escribir a mano.
create policy "ver historial" on public.auditoria
  for select to authenticated using (public.tiene_permiso(local_id, 'historial.ver'));

-- Nadie anónimo accede a nada
revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261114000003_datos_iniciales.sql =====
-- =====================================================================
-- Fase 1 · Datos iniciales: local, permisos, roles y artículos
-- =====================================================================

-- Local inicial (el nombre se puede cambiar después)
insert into public.locales (nombre) values ('Salón principal');

-- Permisos disponibles. Los de eventos, usuarios e historial se usan
-- en las fases siguientes, pero ya quedan definidos.
insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('deposito.ver',        'Depósito',  10, 'Ver el depósito, el stock y los movimientos'),
  ('ingresos.cargar',     'Depósito',  20, 'Cargar ingresos (compras)'),
  ('deposito.ajustar',    'Depósito',  30, 'Hacer ajustes manuales y corregir o anular ingresos'),
  ('articulos.editar',    'Depósito',  40, 'Crear, editar y desactivar artículos y precios'),
  ('eventos.gestionar',   'Eventos',   50, 'Crear eventos y ver todos los eventos'),
  ('eventos.cargar',      'Eventos',   60, 'Cargar datos en los eventos asignados'),
  ('usuarios.gestionar',  'Usuarios',  70, 'Crear usuarios, asignar roles, permisos y eventos'),
  ('historial.ver',       'Usuarios',  80, 'Ver el historial de cambios');

insert into public.roles (nombre, descripcion, es_sistema) values
  ('Administrador', 'Todos los permisos', true),
  ('Encargado de la noche', 'Carga stock inicial, reposiciones, stock final, retiros y bebida abierta en los eventos asignados', true);

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where r.nombre = 'Administrador';

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, 'eventos.cargar' from public.roles r where r.nombre = 'Encargado de la noche';

-- Artículos iniciales, todos con stock en 0 (no se carga ningún movimiento)
insert into public.articulos (local_id, nombre, marca, tamano, unidad)
select (select id from public.locales order by creado_en limit 1), v.nombre, v.marca, v.tamano, v.unidad
from (values
  ('Miller',              'Miller',         null,    'unidad'),
  ('Coca Cola 2.0 L',     'Coca Cola',      '2.0 L', 'unidad'),
  ('Coca Cola 1.5 L',     'Coca Cola',      '1.5 L', 'unidad'),
  ('Pepsi lata',          'Pepsi',          'lata',  'unidad'),
  ('Sprite 2.0 L',        'Sprite',         '2.0 L', 'unidad'),
  ('Sprite 1.5 L',        'Sprite',         '1.5 L', 'unidad'),
  ('Tónica',              null,             null,    'unidad'),
  ('Agua Villavicencio',  'Villavicencio',  null,    'unidad'),
  ('Agua',                null,             null,    'unidad'),
  ('Soda',                null,             null,    'unidad'),
  ('Jugo Baggio',         'Baggio',         null,    'unidad'),
  ('Campari',             'Campari',        null,    'unidad'),
  ('Cynar',               'Cynar',          null,    'unidad'),
  ('Aperol',              'Aperol',         null,    'unidad'),
  ('Pomelo 1.5 L',        null,             '1.5 L', 'unidad'),
  ('Havana Club',         'Havana Club',    null,    'unidad'),
  ('Speed',               'Speed',          null,    'unidad'),
  ('Mercier Extra Brut',  'Mercier',        null,    'unidad'),
  ('Mercier Dulce',       'Mercier',        null,    'unidad'),
  ('Mercier Rosé',        'Mercier',        null,    'unidad'),
  ('Gin Heredero',        'Heredero',       null,    'unidad'),
  ('Skyy',                'Skyy',           null,    'unidad'),
  ('Chandon Extra Brut',  'Chandon',        null,    'unidad'),
  ('Chandon Délice',      'Chandon',        null,    'unidad'),
  ('Fernet 750 cc',       'Fernet Branca',  '750 cc','unidad'),
  ('Fernet 1 L',          'Fernet Branca',  '1 L',   'unidad'),
  ('Red Label',           'Johnnie Walker', null,    'unidad'),
  ('Jägermeister',        'Jägermeister',   null,    'unidad'),
  ('Absolut',             'Absolut',        null,    'unidad'),
  ('Hielo',               null,             'bolsa', 'bolsa'),
  ('Vasos',               null,             'unidad','unidad')
) as v(nombre, marca, tamano, unidad);

-- La carga inicial no es un "cambio" de nadie: no ensuciamos el historial
delete from public.auditoria;
