-- ACTUALIZACIÓN: proveedores en los ingresos. Pegalo en Supabase → SQL Editor → Run (una sola vez).

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
