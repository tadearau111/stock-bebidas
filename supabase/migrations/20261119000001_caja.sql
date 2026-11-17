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
