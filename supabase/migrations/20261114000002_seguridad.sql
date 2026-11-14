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
