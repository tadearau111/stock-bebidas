-- ACTUALIZACIÓN: precios solo para quien tiene permiso. Pegalo en Supabase → SQL Editor → Run (una sola vez). Antes tiene que estar corrida la de roles (actualizacion-roles-deposito.sql).

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
