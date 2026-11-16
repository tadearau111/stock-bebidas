-- ACTUALIZACIÓN: tragos y vasos también en consumo de personal. Pegalo en Supabase → SQL Editor → Run (una sola vez).

-- Los tragos y vasos también se pueden cargar como consumo de personal
-- (antes solo en cortesías).
alter table public.retiros drop constraint if exists trago_solo_en_cortesia;
