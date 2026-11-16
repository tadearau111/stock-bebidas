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
