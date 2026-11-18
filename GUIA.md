# Guía para poner la app en internet

Esta guía es para la administradora. No hace falta saber programar: son clics y copiar y pegar.

Vas a necesitar tres cuentas gratis: **GitHub**, **Supabase** y **Vercel**.

---

## Paso 1 · Crear la base de datos en Supabase (10 minutos)

1. Entrá a **supabase.com** y tocá **Start your project**. Elegí **Continue with GitHub**.
2. Tocá **New project** y completá:
   - **Name:** `stock-bebidas`
   - **Database Password:** tocá **Generate a password** y guardala en un lugar seguro.
   - **Region:** **South America (São Paulo)**.
3. Esperá unos 2 minutos a que el proyecto esté listo.
4. En el menú de la izquierda, entrá a **SQL Editor** y tocá **+ New query**.
5. Abrí el archivo `supabase/instalar-todo.sql` del proyecto. Copiá **todo** el contenido, pegalo en el editor y tocá **Run**.
   Tiene que aparecer **"Success. No rows returned"**.
   Esto crea las tablas, las reglas de seguridad y los 31 artículos iniciales.
6. Entrá a **Authentication**, después a **Sign In / Providers**, y **desactivá "Allow new users to sign up"**.
   Así nadie puede registrarse solo: los usuarios los vas a crear vos.
7. Entrá a **Authentication**, después a **Users**, tocá **Add user** y elegí **Create new user**:
   - Poné tu email y una contraseña.
   - Dejá tildado **Auto Confirm User**.

   **El primer usuario que se crea queda automáticamente como Administrador.**
8. Entrá a **Project Settings**, después a **API**, y anotá estos dos datos (ninguno es secreto):
   - **Project URL**
   - **Publishable key** (o **anon key**)

## Paso 2 · Publicar en Vercel (5 minutos)

1. Entrá a **vercel.com** y tocá **Sign Up**. Elegí el plan **Hobby** y **Continue with GitHub**.
2. Tocá **Add New…**, después **Project**, y elegí el repositorio `stock-bebidas`.
3. Antes de tocar Deploy, abrí **Environment Variables** y cargá estas dos:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | la Project URL del paso 1.8 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | la Publishable key del paso 1.8 |

   - Si Vercel pregunta el tipo de variable, elegí **Config** (no "Secret"): estas dos claves están hechas para ser públicas.
   - Si aparece "Optional Integrations → Supabase → Add", **no lo toques** (crearía otra base de datos).
4. Tocá **Deploy**. En 1 o 2 minutos te da un link del tipo `stock-bebidas.vercel.app`.
5. Volvé a Supabase. Entrá a **Authentication**, después a **URL Configuration**, y en **Site URL** pegá ese link.

6. Para poder crear usuarios desde la app, agregá en Vercel una tercera variable **de tipo Secret**:

   | Name | Value |
   |---|---|
   | `SUPABASE_SECRET_KEY` | En Supabase: Project Settings → API Keys → **Secret keys** (empieza con `sb_secret_`) |

   Esta sí es privada: no la compartas con nadie.

Listo: abrí el link desde el celular o la computadora e ingresá con tu email y contraseña.

---

## Cosas para saber

- **Supabase gratis "pausa" el proyecto si nadie lo usa durante 7 días.** No se pierde nada: entrás a supabase.com y tocás **Restore project**.
- Cada vez que se guarda una versión nueva del código en GitHub, **Vercel actualiza la página sola**.
- Nunca compartas la **Database Password** ni la clave **secret / service_role**. Las dos claves de la tabla del paso 2 sí se pueden compartir.

## Instalar la app y usarla sin internet

**Instalar (una vez por celular):**

- **iPhone:** abrí la plataforma en **Safari** → botón **Compartir** (cuadrado con flecha) → **“Agregar a inicio”** → **Agregar**.
- **Android:** abrila en **Chrome** → los **tres puntitos** → **“Instalar app”** (o “Agregar a la pantalla principal”). También aparece el botón **Instalar** en Inicio y en “Más”.
- **Computadora:** en Chrome o Edge, el ícono de instalar a la derecha de la barra de direcciones.

**Sin internet:**

- Abrí la app **al menos una vez con internet** en ese celular (y con tu usuario). Los eventos de estos días (de 3 días atrás a 2 semanas adelante) quedan guardados solos.
- Sin conexión aparece una franja amarilla arriba. Todo lo que se carga **en un evento** (barras, stock inicial y final, reposiciones, retiros, bebida abierta, gastos, caja, cajeros) se guarda en el celular y **se manda solo** cuando vuelve internet, con la hora en que se cargó.
- Lo que no es de un evento (depósito, caja fuerte, usuarios…) necesita internet.
- **No cierres sesión** mientras haya cambios esperando: si lo hacés, quedan en el celular y se mandan la próxima vez que entres con tu usuario.
- Si al mandarse la base rechaza algún cambio (por ejemplo, alguien borró ese dato mientras tanto), la franja lo avisa en rojo: tocá **Ver** para revisarlo.
