# HUB · Stock de Bebidas

Plataforma web para manejar el stock de bebidas del depósito y el control de cada evento (barras, reposiciones, stock final, retiros y bebida abierta). Funciona en celular y computadora.

- **Guía de instalación (para la administradora):** [GUIA.md](GUIA.md)
- **Especificación:** reglas de negocio, módulos y fases del proyecto.

## Estado

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Login, artículos, depósito con ingresos y ajustes, alertas de mínimo | ✅ |
| 2 | Eventos, barras, reposiciones, stock final, retiros, bebida abierta, resumen | ✅ |
| 3 | Usuarios, roles y permisos configurables, historial | ✅ |
| 4 | Exportar a Excel y PDF, compartir por WhatsApp | ✅ |
| 5 | App instalable y funcionamiento sin conexión | Pendiente |

## Técnico

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase: Postgres, Auth y Row Level Security (los permisos los controla la base de datos)
- Hosting en Vercel: cada cambio en `main` se publica solo

### Reglas clave

- Todo se cuenta en unidades (el hielo, en bolsas).
- `Consumido = Stock inicial + Reposiciones − Stock final`.
- El stock del depósito no se guarda como un número suelto: se calcula como ingresos + ajustes − lo consumido en las barras.
- Los retiros ya están dentro del consumido. La bebida abierta es solo informativa: ninguno de los dos vuelve a descontar del depósito.
- Los eventos nunca se bloquean, y todo cambio queda en el historial (`auditoria`).

### Base de datos

- `supabase/migrations/`: cambios de la base, en orden.
- `supabase/instalar-todo.sql`: todo junto, para una base nueva.
- `supabase/actualizacion-faseN.sql`: actualizaciones para una base ya instalada.

### Variables de entorno

Ver `.env.example`. `SUPABASE_SECRET_KEY` solo se usa en el servidor (`app/api/usuarios`).

### Pruebas

```bash
npm test
```

Pruebas de base de datos contra un Supabase local (`npx supabase start`):

```bash
node scripts/probar-seguridad.mjs   # base recién creada
node scripts/probar-eventos.mjs
node scripts/probar-usuarios.mjs
```

Los scripts necesitan `PUBLISHABLE_KEY` y `SECRET_KEY` del Supabase local (`npx supabase status -o env`).
