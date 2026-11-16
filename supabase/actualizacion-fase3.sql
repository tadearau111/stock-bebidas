-- ACTUALIZACIÓN FASE 3: pegalo en Supabase → SQL Editor → Run (una sola vez).

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
