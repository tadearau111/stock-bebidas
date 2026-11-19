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

-- ===== supabase/migrations/20261119000001_caja.sql =====
-- =====================================================================
-- Caja del evento: ingresos de barras, boletería y guardarropas,
-- gastos de la noche, cambio para la próxima caja y retiro a caja fuerte.
-- Los montos están en pesos. Vacío = todavía no se cargó.
-- =====================================================================

create table public.evento_caja (
  evento_id             uuid primary key references public.eventos(id) on delete cascade,
  local_id              uuid not null references public.locales(id),
  -- Barras
  efectivo_real         numeric(14, 2) check (efectivo_real >= 0),     -- lo que hay en la caja
  efectivo_sistema      numeric(14, 2) check (efectivo_sistema >= 0),  -- lo que dice el sistema de venta
  cierre_lotes          numeric(14, 2) check (cierre_lotes >= 0),      -- lo que dicen los posnet
  tarjetas_sistema      numeric(14, 2) check (tarjetas_sistema >= 0),  -- tarjetas según el sistema de venta
  -- Boletería y guardarropas (no pasan por el sistema de venta)
  boleteria_efectivo    numeric(14, 2) check (boleteria_efectivo >= 0),
  boleteria_lotes       numeric(14, 2) check (boleteria_lotes >= 0),
  guardarropas_efectivo numeric(14, 2) check (guardarropas_efectivo >= 0),
  guardarropas_lotes    numeric(14, 2) check (guardarropas_lotes >= 0),
  -- Cierre
  cambio_proxima_caja   numeric(14, 2) check (cambio_proxima_caja >= 0),
  vasos_no_devueltos    integer check (vasos_no_devueltos >= 0),
  notas                 text,
  actualizado_por       uuid references public.perfiles(id) default auth.uid(),
  actualizado_en        timestamptz not null default now()
);

create table public.evento_gastos (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  local_id   uuid not null references public.locales(id),
  monto      numeric(14, 2) not null check (monto > 0),
  detalle    text not null check (length(trim(detalle)) > 0),
  hora       timestamptz not null default now(),
  creado_por uuid references public.perfiles(id) default auth.uid(),
  creado_en  timestamptz not null default now()
);
create index evento_gastos_evento on public.evento_gastos (evento_id);

create trigger completar before insert or update of evento_id on public.evento_caja
  for each row execute function public.completar_desde_evento();
create trigger completar before insert or update of evento_id on public.evento_gastos
  for each row execute function public.completar_desde_evento();

create function public.caja_tocar() returns trigger
language plpgsql as $$
begin
  new.actualizado_en := now();
  new.actualizado_por := auth.uid();
  return new;
end $$;
create trigger caja_tocar before update on public.evento_caja
  for each row execute function public.caja_tocar();

alter table public.evento_caja   enable row level security;
alter table public.evento_gastos enable row level security;

create policy "ver" on public.evento_caja for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.evento_caja for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "ver" on public.evento_gastos for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.evento_gastos for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));

create trigger auditar after insert or update or delete on public.evento_caja
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.evento_gastos
  for each row execute function public.registrar_auditoria();

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261120000001_proveedores.sql =====
-- =====================================================================
-- Proveedores: registro de a quién se le compró cada ingreso (opcional)
-- =====================================================================

create table public.proveedores (
  id        uuid primary key default gen_random_uuid(),
  local_id  uuid not null references public.locales(id),
  nombre    text not null check (length(trim(nombre)) > 0),
  activo    boolean not null default true,
  creado_en timestamptz not null default now()
);
create unique index proveedores_nombre_unico on public.proveedores (local_id, lower(trim(nombre)));

alter table public.proveedores enable row level security;
create policy "ver proveedores" on public.proveedores
  for select to authenticated using (public.es_miembro(local_id));
-- Quien carga ingresos puede sumar proveedores nuevos; editarlos también quien edita artículos
create policy "crear proveedores" on public.proveedores
  for insert to authenticated
  with check (public.tiene_permiso(local_id, 'ingresos.cargar') or public.tiene_permiso(local_id, 'articulos.editar'));
create policy "editar proveedores" on public.proveedores
  for update to authenticated
  using (public.tiene_permiso(local_id, 'ingresos.cargar') or public.tiene_permiso(local_id, 'articulos.editar'))
  with check (public.tiene_permiso(local_id, 'ingresos.cargar') or public.tiene_permiso(local_id, 'articulos.editar'));

create trigger auditar after insert or update or delete on public.proveedores
  for each row execute function public.registrar_auditoria();

-- Cada ingreso puede tener su proveedor
alter table public.movimientos add column proveedor_id uuid references public.proveedores(id) on delete restrict;
alter table public.movimientos add constraint proveedor_solo_en_ingresos check (proveedor_id is null or tipo = 'ingreso');
create index movimientos_proveedor on public.movimientos (proveedor_id);

create function public.validar_proveedor_del_local() returns trigger
language plpgsql as $$
begin
  if new.proveedor_id is not null
     and not exists (select 1 from public.proveedores p where p.id = new.proveedor_id and p.local_id = new.local_id) then
    raise exception 'El proveedor no pertenece a este local';
  end if;
  return new;
end $$;

-- Corre después de completar el local del movimiento (los triggers van en orden alfabético)
create trigger zz_validar_proveedor before insert or update of proveedor_id, articulo_id on public.movimientos
  for each row execute function public.validar_proveedor_del_local();

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261121000001_info.sql =====
-- =====================================================================
-- Info: notas por fecha sobre los próximos eventos (horarios, personal
-- a convocar y cosas a tener en cuenta). Como un block de notas.
-- =====================================================================

insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('info.ver',    'Info', 90, 'Ver las notas de Info'),
  ('info.editar', 'Info', 91, 'Cargar y editar las notas de Info');
-- (el Administrador los recibe solo; el encargado de la noche puede leerlas)
insert into public.rol_permisos (rol_id, permiso_codigo)
select id, 'info.ver' from public.roles where nombre = 'Encargado de la noche'
on conflict do nothing;

create table public.notas_info (
  id             uuid primary key default gen_random_uuid(),
  local_id       uuid not null references public.locales(id),
  fecha          date not null,
  evento_id      uuid references public.eventos(id) on delete set null,
  titulo         text not null check (length(trim(titulo)) > 0),
  hora_apertura  time,
  hora_cierre    time,
  -- personal a convocar: [{ "rol": "Seguridad", "cantidad": 4, "detalle": "2 en puerta" }, ...]
  personal       jsonb not null default '[]'::jsonb check (jsonb_typeof(personal) = 'array'),
  notas          text,
  creado_por     uuid references public.perfiles(id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);
create index notas_info_fecha on public.notas_info (local_id, fecha);

create trigger notas_info_actualizado_en before update on public.notas_info
  for each row execute function public.tocar_actualizado_en();

alter table public.notas_info enable row level security;
create policy "ver notas" on public.notas_info
  for select to authenticated using (public.tiene_permiso(local_id, 'info.ver') or public.tiene_permiso(local_id, 'info.editar'));
create policy "editar notas" on public.notas_info
  for all to authenticated
  using (public.tiene_permiso(local_id, 'info.editar'))
  with check (public.tiene_permiso(local_id, 'info.editar'));

create trigger auditar after insert or update or delete on public.notas_info
  for each row execute function public.registrar_auditoria();

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261122000001_eventos_archivados.sql =====
-- =====================================================================
-- Archivar eventos: salen de la lista principal pero NO se borran,
-- así el stock del depósito (que se calcula con lo consumido en todos
-- los eventos) no cambia. Se pueden desarchivar.
-- =====================================================================

alter table public.eventos add column archivado boolean not null default false;
alter table public.eventos add column archivado_en timestamptz;

create index eventos_activos on public.eventos (local_id, archivado, fecha desc);

-- ===== supabase/migrations/20261123000001_papelera.sql =====
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

-- ===== supabase/migrations/20261124000001_caja_fuerte.sql =====
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

-- ===== supabase/migrations/20261125000001_caja_fuerte_cierres.sql =====
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

-- ===== supabase/migrations/20261126000001_precio_mayorista_tipo_barra.sql =====
-- =====================================================================
-- Precio mayorista y tipo de barra por evento
--
-- · Cada artículo tiene precio de costo y precio mayorista.
--   (El precio de venta deja de usarse en la app; la columna queda
--   guardada, oculta, para no perder lo que ya se haya cargado.)
-- · Cada evento es de "barra propia" (se calcula con precio de costo)
--   o de "barra concesionada" (se calcula con precio mayorista).
-- =====================================================================

alter table public.articulos add column precio_mayorista numeric(12, 2) check (precio_mayorista >= 0);

alter table public.eventos add column tipo_barra text not null default 'propia'
  check (tipo_barra in ('propia', 'concesionada'));

-- La vista del stock lista las columnas del artículo: se rearma para incluir la nueva
drop view public.stock_articulos;
create view public.stock_articulos with (security_invoker = true) as
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
  s.total::integer                               as stock_actual,
  s.total < a.stock_minimo                       as bajo_minimo,
  greatest(a.stock_minimo - s.total, 0)::integer as faltante,
  s.usos::integer                                as cantidad_movimientos
from public.articulos a
join stock s on s.id = a.id;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;

-- ===== supabase/migrations/20261128000001_pagos_tareas.sql =====
-- =====================================================================
-- Tareas de la semana: pagos a empleados con el efectivo de la caja fuerte
--
-- Cada pago es un movimiento de la caja fuerte de tipo "pago" (se resta
-- del efectivo), con el día, a quién se le pagó y qué tareas hizo.
-- =====================================================================

alter table public.caja_fuerte_movimientos drop constraint caja_fuerte_movimientos_tipo_check;
alter table public.caja_fuerte_movimientos add constraint caja_fuerte_movimientos_tipo_check
  check (tipo in ('retiro', 'ingreso', 'pago'));

-- A quién se le pagó (solo en los pagos de tareas)
alter table public.caja_fuerte_movimientos add column persona text;
-- Horas trabajadas (opcional, solo informativo)
alter table public.caja_fuerte_movimientos add column horas numeric(6, 2) check (horas is null or horas > 0);
alter table public.caja_fuerte_movimientos add constraint pago_con_persona
  check (tipo <> 'pago' or length(trim(coalesce(persona, ''))) > 0);

-- Los resúmenes mensuales guardan también el total de pagos
alter table public.caja_fuerte_cierres add column pagos numeric(14, 2) not null default 0;

-- La papelera muestra los pagos como "Pago de tareas"
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

-- ===== supabase/migrations/20261129000001_cajeros.sql =====
-- =====================================================================
-- Cajeros del evento y retiros de dinero durante la noche
--
-- Es solo de CONTROL (seguridad: que no se junte mucha plata en las cajas).
-- No suma ni resta en la caja del evento ni en la caja fuerte: la venta
-- total se sigue cargando a mano en la pestaña Caja.
-- =====================================================================

create table public.evento_cajeros (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  local_id   uuid not null references public.locales(id),
  nombre     text not null check (length(trim(nombre)) > 0),
  orden      integer not null default 0,
  creado_por uuid references public.perfiles(id) default auth.uid(),
  creado_en  timestamptz not null default now()
);
create index evento_cajeros_evento on public.evento_cajeros (evento_id);

create table public.cajero_retiros (
  id         uuid primary key default gen_random_uuid(),
  cajero_id  uuid not null references public.evento_cajeros(id) on delete cascade,
  evento_id  uuid not null references public.eventos(id) on delete cascade,
  local_id   uuid not null references public.locales(id),
  monto      numeric(14, 2) not null check (monto > 0),
  hora       timestamptz not null default now(),
  notas      text,
  creado_por uuid references public.perfiles(id) default auth.uid(),
  creado_en  timestamptz not null default now()
);
create index cajero_retiros_evento on public.cajero_retiros (evento_id);
create index cajero_retiros_cajero on public.cajero_retiros (cajero_id);

create trigger completar before insert or update of evento_id on public.evento_cajeros
  for each row execute function public.completar_desde_evento();

-- El retiro toma el evento y el local de su cajero
create function public.completar_desde_cajero() returns trigger
language plpgsql as $$
begin
  select c.evento_id, c.local_id into new.evento_id, new.local_id from public.evento_cajeros c where c.id = new.cajero_id;
  if new.evento_id is null then raise exception 'El cajero no existe'; end if;
  return new;
end $$;
create trigger completar before insert or update of cajero_id on public.cajero_retiros
  for each row execute function public.completar_desde_cajero();

alter table public.evento_cajeros enable row level security;
alter table public.cajero_retiros enable row level security;

create policy "ver" on public.evento_cajeros for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.evento_cajeros for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));
create policy "ver" on public.cajero_retiros for select to authenticated using (public.puede_ver_evento(evento_id));
create policy "cargar" on public.cajero_retiros for all to authenticated
  using (public.puede_editar_evento(evento_id)) with check (public.puede_editar_evento(evento_id));

create trigger auditar after insert or update or delete on public.evento_cajeros
  for each row execute function public.registrar_auditoria();
create trigger auditar after insert or update or delete on public.cajero_retiros
  for each row execute function public.registrar_auditoria();

-- La papelera reconoce cajeros y retiros (y los guarda al borrar un evento)
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

  when 'cajero' then
    select * into r from evento_cajeros where id = p_id;
    if not found then raise exception 'Ya no existe.' using errcode = 'P0001'; end if;
    v_local := r.local_id; v_evento := r.evento_id;
    v_ok := puede_editar_evento(v_evento);
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
    v_ok := puede_editar_evento(v_evento);
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

-- ===== supabase/migrations/20261130000001_roles_deposito.sql =====
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

-- ===== supabase/migrations/20261201000001_precios.sql =====
-- =====================================================================
-- Precios de los artículos: solo los ve quien tiene el permiso "precios.ver"
--
-- Permiso nuevo "precios.ver". Lo reciben los roles que editan artículos o
-- gestionan eventos (el Administrador, entre ellos). Sin ese permiso, por
-- ejemplo el Encargado de depósito, el depósito se ve SOLO con cantidades.
-- Lo controla la base de datos:
--   · la vista del stock devuelve los precios vacíos a quien no tiene el permiso;
--   · nadie puede leer las columnas de precio de la tabla de artículos directo.
-- (Si en el futuro se agrega una columna a "articulos", hay que sumarla al
-- "grant select (...)" de abajo para que se pueda leer.)
-- =====================================================================

insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('precios.ver', 'Depósito', 45, 'Ver los precios de costo y mayorista de los artículos')
on conflict (codigo) do nothing;

insert into public.rol_permisos (rol_id, permiso_codigo)
select distinct rp.rol_id, 'precios.ver'
  from public.rol_permisos rp
 where rp.permiso_codigo in ('articulos.editar', 'eventos.gestionar')
on conflict do nothing;

-- Precios de un artículo, solo si quien pregunta tiene el permiso
create function public.precios_articulo(p_id uuid)
returns table (precio_costo numeric, precio_mayorista numeric, precio_venta numeric)
language sql stable security definer set search_path = public as $$
  select a.precio_costo, a.precio_mayorista, a.precio_venta
    from public.articulos a
   where a.id = p_id and public.tiene_permiso(a.local_id, 'precios.ver')
$$;
revoke execute on function public.precios_articulo(uuid) from public, anon;
grant execute on function public.precios_articulo(uuid) to authenticated;

-- La vista del stock toma los precios de esa función (vacíos sin permiso)
drop view public.stock_articulos;
create view public.stock_articulos with (security_invoker = true) as
with stock as (
  select a.id,
         coalesce((select sum(m.cantidad) from public.movimientos m where m.articulo_id = a.id), 0)
         - coalesce((select c.consumido from public.consumo_en_barras c where c.articulo_id = a.id), 0) as total,
         (select count(*) from public.movimientos m where m.articulo_id = a.id)
         + (select count(*) from public.barra_articulos ba where ba.articulo_id = a.id) as usos
    from public.articulos a
)
select
  a.id, a.local_id, a.nombre, a.marca, a.tamano, a.unidad, a.stock_minimo,
  p.precio_costo, p.precio_venta,
  a.activo, a.creado_en, a.actualizado_en,
  p.precio_mayorista,
  s.total::integer                               as stock_actual,
  s.total < a.stock_minimo                       as bajo_minimo,
  greatest(a.stock_minimo - s.total, 0)::integer as faltante,
  s.usos::integer                                as cantidad_movimientos
from public.articulos a
join stock s on s.id = a.id
left join lateral public.precios_articulo(a.id) p on true;

-- Las columnas de precio de la tabla no se pueden leer directo (sí cargar y cambiar, con permiso)
revoke select on public.articulos from authenticated;
grant select (id, local_id, nombre, marca, tamano, unidad, stock_minimo, activo, creado_en, actualizado_en)
  on public.articulos to authenticated;

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
