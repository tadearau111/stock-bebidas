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
