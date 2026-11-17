-- ACTUALIZACIÓN: precio mayorista y tipo de barra (propia / concesionada). Pegalo en Supabase → SQL Editor → Run (una sola vez).

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
