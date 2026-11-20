-- ACTUALIZACIÓN: cierre de cada cajero (efectivo sistema, tarjetas sistema, cierre de lotes). Pegalo en Supabase → SQL Editor → Run (una sola vez).

-- =====================================================================
-- Cierre de cada cajero: efectivo sistema, tarjetas sistema y cierre de lotes
--
-- Se comparan con lo real de ese cajero: el efectivo real es el total de
-- sus retiros de la noche, y las tarjetas reales son el cierre de lotes.
-- Sigue siendo solo de control: no suma ni resta en la Caja del evento.
-- =====================================================================

alter table public.evento_cajeros
  add column efectivo_sistema numeric(14, 2) check (efectivo_sistema >= 0),
  add column tarjetas_sistema numeric(14, 2) check (tarjetas_sistema >= 0),
  add column cierre_lotes     numeric(14, 2) check (cierre_lotes >= 0);

revoke all on all tables in schema public from anon;
revoke execute on all functions in schema public from anon;
