-- ARCHIVO GENERADO: une las migraciones de supabase/migrations en orden.
-- Para una base NUEVA: pegalo completo en Supabase → SQL Editor → Run (una sola vez).
-- Si ya instalaste una versión anterior, corré solo los archivos de actualización.

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

-- ===== supabase/migrations/20261116000001_eventos.sql =====
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

-- ===== supabase/migrations/20261117000001_usuarios_historial.sql =====
-- =====================================================================
-- Fase 3 · Usuarios, roles y permisos, historial
-- =====================================================================

-- ---------------------------------------------------------------------
-- Historial: también registrar cambios de usuarios, roles y permisos
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
    coalesce(v_fila ->> 'id', v_fila ->> 'evento_id', v_fila ->> 'usuario_id', v_fila ->> 'rol_id', ''),
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'modificacion' else 'baja' end,
    v_cambios,
    case when tg_table_name = 'articulos' then (v_fila ->> 'id')::uuid
         else nullif(v_fila ->> 'articulo_id', '')::uuid end,
    case when tg_table_name = 'eventos' then (v_fila ->> 'id')::uuid
         else nullif(v_fila ->> 'evento_id', '')::uuid end
  );
  return coalesce(new, old);
end $$;

create trigger auditar after insert or update or delete on public.perfiles
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.miembros
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.roles
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.rol_permisos
  for each row execute function public.registrar_auditoria();

-- Lo que no pertenece a un local (perfiles, roles) lo ve quien tenga
-- permiso de historial en algún local.
drop policy "ver historial" on public.auditoria;
create policy "ver historial" on public.auditoria
  for select to authenticated
  using (
    public.tiene_permiso(local_id, 'historial.ver')
    or (local_id is null and public.tiene_permiso_en_algun_local('historial.ver'))
  );

-- ---------------------------------------------------------------------
-- Protecciones para no quedarse sin administrador
-- ---------------------------------------------------------------------

-- Cada local tiene que tener al menos un usuario activo que pueda gestionar usuarios
create function public.quedan_administradores(p_local uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from public.miembros m
      join public.perfiles p on p.id = m.usuario_id
      join public.rol_permisos rp on rp.rol_id = m.rol_id
     where m.local_id = p_local and m.activo and p.activo
       and rp.permiso_codigo = 'usuarios.gestionar'
  );
$$;

create function public.proteger_miembros() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.quedan_administradores(coalesce(old.local_id, new.local_id)) then
    raise exception 'Tiene que quedar al menos un administrador activo en el local.'
      using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger proteger_administradores
  after update or delete on public.miembros
  deferrable initially deferred
  for each row execute function public.proteger_miembros();

create function public.proteger_perfiles() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_local uuid;
begin
  for v_local in select local_id from public.miembros where usuario_id = new.id loop
    if not public.quedan_administradores(v_local) then
      raise exception 'Tiene que quedar al menos un administrador activo en el local.'
        using errcode = 'P0001';
    end if;
  end loop;
  return null;
end $$;

create constraint trigger proteger_administradores
  after update of activo on public.perfiles
  deferrable initially deferred
  for each row execute function public.proteger_perfiles();

-- El rol Administrador siempre tiene todos los permisos (evita bloquearse)
create function public.proteger_rol_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.roles r where r.id = old.rol_id and r.nombre = 'Administrador')
     and exists (select 1 from public.permisos p where p.codigo = old.permiso_codigo) then
    raise exception 'No se le pueden quitar permisos al rol Administrador.' using errcode = 'P0001';
  end if;
  return old;
end $$;

create trigger proteger_rol_admin
  before delete on public.rol_permisos
  for each row execute function public.proteger_rol_admin();

-- Los roles de sistema no se borran ni se renombran
create function public.proteger_roles_sistema() returns trigger
language plpgsql as $$
begin
  if old.es_sistema and (tg_op = 'DELETE' or new.nombre <> old.nombre or not new.es_sistema) then
    raise exception 'Los roles Administrador y Encargado de la noche no se pueden borrar ni renombrar.' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end $$;

create trigger proteger_roles_sistema
  before update or delete on public.roles
  for each row execute function public.proteger_roles_sistema();

-- Un permiso nuevo siempre se suma al Administrador
create function public.permiso_nuevo_a_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.rol_permisos (rol_id, permiso_codigo)
  select id, new.codigo from public.roles where nombre = 'Administrador'
  on conflict do nothing;
  return new;
end $$;

create trigger permiso_nuevo_a_admin
  after insert on public.permisos
  for each row execute function public.permiso_nuevo_a_admin();

-- ---------------------------------------------------------------------
-- Lista de usuarios del local (para la pantalla de administración)
-- ---------------------------------------------------------------------
create function public.usuarios_del_local(p_local uuid)
returns table (
  usuario_id uuid, nombre text, email text, perfil_activo boolean,
  rol_id uuid, rol text, miembro_activo boolean, creado_en timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre, p.email, p.activo, m.rol_id, r.nombre, m.activo, p.creado_en
    from public.miembros m
    join public.perfiles p on p.id = m.usuario_id
    join public.roles r on r.id = m.rol_id
   where m.local_id = p_local
     and public.tiene_permiso(p_local, 'usuarios.gestionar')
   order by p.activo desc, p.nombre;
$$;

-- Nombres de usuarios para mostrar en el historial y en las cargas
create function public.nombres_usuarios(p_local uuid)
returns table (usuario_id uuid, nombre text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nombre
    from public.perfiles p
   where public.es_miembro(p_local)
     and exists (select 1 from public.miembros m where m.usuario_id = p.id and m.local_id = p_local);
$$;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261118000001_tragos.sql =====
-- =====================================================================
-- Tragos y vasos para las cortesías
--
-- Además de una botella de la barra, una cortesía puede ser un trago o un
-- vaso (ej: "Trago Absolut", "Vaso gaseosa"). Se cuentan en vasos y son
-- informativos: salen de las botellas que ya están en la barra (y que ya
-- cuentan en el consumido), así que no se descuentan del depósito.
-- =====================================================================

create table public.tragos (
  id        uuid primary key default gen_random_uuid(),
  local_id  uuid not null references public.locales(id),
  nombre    text not null check (length(trim(nombre)) > 0),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index tragos_nombre_unico on public.tragos (local_id, lower(trim(nombre)));

alter table public.tragos enable row level security;
create policy "ver tragos" on public.tragos
  for select to authenticated using (public.es_miembro(local_id));
create policy "crear tragos" on public.tragos
  for insert to authenticated with check (public.tiene_permiso(local_id, 'articulos.editar'));
create policy "editar tragos" on public.tragos
  for update to authenticated
  using (public.tiene_permiso(local_id, 'articulos.editar'))
  with check (public.tiene_permiso(local_id, 'articulos.editar'));
create policy "borrar tragos" on public.tragos
  for delete to authenticated using (public.tiene_permiso(local_id, 'articulos.editar'));

create trigger auditar after insert or update or delete on public.tragos
  for each row execute function public.registrar_auditoria();

-- Un retiro es de una botella (articulo_id) o de un trago (trago_id), nunca de los dos.
-- Los tragos solo se usan en cortesías.
alter table public.retiros alter column articulo_id drop not null;
alter table public.retiros add column trago_id uuid references public.tragos(id) on delete restrict;
alter table public.retiros add constraint retiro_articulo_o_trago check ((articulo_id is null) <> (trago_id is null));
alter table public.retiros add constraint trago_solo_en_cortesia check (trago_id is null or tipo = 'cortesia');

-- Validaciones: el artículo o el trago tienen que ser del mismo local
create or replace function public.validar_articulo_del_local() returns trigger
language plpgsql as $$
begin
  if new.articulo_id is not null
     and not exists (select 1 from public.articulos a where a.id = new.articulo_id and a.local_id = new.local_id) then
    raise exception 'El artículo no pertenece a este local';
  end if;
  return new;
end $$;

create function public.validar_trago_del_local() returns trigger
language plpgsql as $$
begin
  if new.trago_id is not null
     and not exists (select 1 from public.tragos t where t.id = new.trago_id and t.local_id = new.local_id) then
    raise exception 'El trago no pertenece a este local';
  end if;
  return new;
end $$;

create trigger validar_trago before insert or update of trago_id on public.retiros
  for each row execute function public.validar_trago_del_local();

-- Tragos iniciales en cada local
insert into public.tragos (local_id, nombre)
select l.id, t.nombre
  from public.locales l
 cross join (values ('Trago Jägermeister'), ('Trago Absolut'), ('Trago Skyy'), ('Vaso gaseosa')) as t(nombre)
on conflict do nothing;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261118000002_tragos_personal.sql =====
-- Los tragos y vasos también se pueden cargar como consumo de personal
-- (antes solo en cortesías).
alter table public.retiros drop constraint if exists trago_solo_en_cortesia;
