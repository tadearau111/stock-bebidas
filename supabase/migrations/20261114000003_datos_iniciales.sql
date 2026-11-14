-- =====================================================================
-- Fase 1 · Datos iniciales: local, permisos, roles y artículos
-- =====================================================================

-- Local inicial (el nombre se puede cambiar después)
insert into public.locales (nombre) values ('Salón principal');

-- Permisos disponibles. Los de eventos, usuarios e historial se usan
-- en las fases siguientes, pero ya quedan definidos.
insert into public.permisos (codigo, grupo, orden, descripcion) values
  ('deposito.ver',        'Depósito',  10, 'Ver el depósito, el stock y los movimientos'),
  ('ingresos.cargar',     'Depósito',  20, 'Cargar ingresos (compras)'),
  ('deposito.ajustar',    'Depósito',  30, 'Hacer ajustes manuales y corregir o anular ingresos'),
  ('articulos.editar',    'Depósito',  40, 'Crear, editar y desactivar artículos y precios'),
  ('eventos.gestionar',   'Eventos',   50, 'Crear eventos y ver todos los eventos'),
  ('eventos.cargar',      'Eventos',   60, 'Cargar datos en los eventos asignados'),
  ('usuarios.gestionar',  'Usuarios',  70, 'Crear usuarios, asignar roles, permisos y eventos'),
  ('historial.ver',       'Usuarios',  80, 'Ver el historial de cambios');

insert into public.roles (nombre, descripcion, es_sistema) values
  ('Administrador', 'Todos los permisos', true),
  ('Encargado de la noche', 'Carga stock inicial, reposiciones, stock final, retiros y bebida abierta en los eventos asignados', true);

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, p.codigo from public.roles r cross join public.permisos p
 where r.nombre = 'Administrador';

insert into public.rol_permisos (rol_id, permiso_codigo)
select r.id, 'eventos.cargar' from public.roles r where r.nombre = 'Encargado de la noche';

-- Artículos iniciales, todos con stock en 0 (no se carga ningún movimiento)
insert into public.articulos (local_id, nombre, marca, tamano, unidad)
select (select id from public.locales order by creado_en limit 1), v.nombre, v.marca, v.tamano, v.unidad
from (values
  ('Miller',              'Miller',         null,    'unidad'),
  ('Coca Cola 2.0 L',     'Coca Cola',      '2.0 L', 'unidad'),
  ('Coca Cola 1.5 L',     'Coca Cola',      '1.5 L', 'unidad'),
  ('Pepsi lata',          'Pepsi',          'lata',  'unidad'),
  ('Sprite 2.0 L',        'Sprite',         '2.0 L', 'unidad'),
  ('Sprite 1.5 L',        'Sprite',         '1.5 L', 'unidad'),
  ('Tónica',              null,             null,    'unidad'),
  ('Agua Villavicencio',  'Villavicencio',  null,    'unidad'),
  ('Agua',                null,             null,    'unidad'),
  ('Soda',                null,             null,    'unidad'),
  ('Jugo Baggio',         'Baggio',         null,    'unidad'),
  ('Campari',             'Campari',        null,    'unidad'),
  ('Cynar',               'Cynar',          null,    'unidad'),
  ('Aperol',              'Aperol',         null,    'unidad'),
  ('Pomelo 1.5 L',        null,             '1.5 L', 'unidad'),
  ('Havana Club',         'Havana Club',    null,    'unidad'),
  ('Speed',               'Speed',          null,    'unidad'),
  ('Mercier Extra Brut',  'Mercier',        null,    'unidad'),
  ('Mercier Dulce',       'Mercier',        null,    'unidad'),
  ('Mercier Rosé',        'Mercier',        null,    'unidad'),
  ('Gin Heredero',        'Heredero',       null,    'unidad'),
  ('Skyy',                'Skyy',           null,    'unidad'),
  ('Chandon Extra Brut',  'Chandon',        null,    'unidad'),
  ('Chandon Délice',      'Chandon',        null,    'unidad'),
  ('Fernet 750 cc',       'Fernet Branca',  '750 cc','unidad'),
  ('Fernet 1 L',          'Fernet Branca',  '1 L',   'unidad'),
  ('Red Label',           'Johnnie Walker', null,    'unidad'),
  ('Jägermeister',        'Jägermeister',   null,    'unidad'),
  ('Absolut',             'Absolut',        null,    'unidad'),
  ('Hielo',               null,             'bolsa', 'bolsa'),
  ('Vasos',               null,             'unidad','unidad')
) as v(nombre, marca, tamano, unidad);

-- La carga inicial no es un "cambio" de nadie: no ensuciamos el historial
delete from public.auditoria;
