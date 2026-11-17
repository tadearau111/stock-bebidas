// Arma los reportes (depósito, faltantes, resumen de evento) en un formato
// común que después se convierte a Excel, PDF o texto para WhatsApp.

import {
  bebidaAbiertaPorArticulo,
  consumido,
  costosDelEvento,
  detalleRetiros,
  formatoBotellas,
  resumirEvento,
  soloBotellas,
  TIPOS_BARRA,
  textoTotalRetiros,
  totalReposiciones,
  tragosRetirados,
  type ArticuloPrecio,
  type TipoBarra,
} from '../calculos/evento'
import { CAJA_VACIA, cajaCargada, calcularCaja } from '../calculos/caja'
import { nombreMes, type RenglonResumen } from '../calculos/cajaFuerte'
import type { Articulo, DetalleEvento } from '../tipos'

export type Celda = string | number | null

export interface Columna {
  titulo: string
  tipo?: 'texto' | 'numero' | 'pesos'
}

export interface Seccion {
  titulo: string
  columnas: Columna[]
  filas: Celda[][]
  total?: Celda[]
  /** índices de filas que van en rojo (ej: bajo mínimo) */
  resaltar?: number[]
  nota?: string
}

export interface Reporte {
  titulo: string
  subtitulo: string
  /** datos clave arriba de todo: [["Personas", "120"], ...] */
  datos: [string, string][]
  secciones: Seccion[]
  textoWhatsApp: string
  nombreArchivo: string // sin extensión
}

// ------------------------------------------------------------------ Formatos

const numero = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 })
const pesos = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2 })
const fechaLarga = new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const fechaHora = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** Texto de una celda según su tipo (para PDF y WhatsApp). Los espacios raros se normalizan. */
export function textoCelda(valor: Celda, tipo: Columna['tipo'] = 'texto'): string {
  if (valor == null || valor === '') return '—'
  if (typeof valor === 'number') {
    const t = tipo === 'pesos' ? pesos.format(valor) : numero.format(valor)
    return t.replace(/ | /g, ' ')
  }
  return valor
}

export function slug(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function fechaEvento(fecha: string) {
  const [a, m, d] = fecha.split('-').map(Number)
  return fechaLarga.format(new Date(a, m - 1, d))
}

const unidadTexto = (u: 'unidad' | 'bolsa', n: number) => (u === 'bolsa' ? (n === 1 ? 'bolsa' : 'bolsas') : 'u.')

// ------------------------------------------------------------------ Depósito

export function reporteDeposito(articulos: Articulo[], local: string, ahora = new Date()): Reporte {
  const activos = articulos.filter((a) => a.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  const bajos = activos.filter((a) => a.bajo_minimo)
  const hayPrecios = activos.some((a) => a.precio_costo != null || a.precio_mayorista != null)
  const columnas: Columna[] = [
    { titulo: 'Nombre' },
    { titulo: 'Marca' },
    { titulo: 'Tamaño' },
    { titulo: 'Stock actual', tipo: 'numero' },
    { titulo: 'Stock mínimo', tipo: 'numero' },
    ...(hayPrecios ? [{ titulo: 'Precio costo', tipo: 'pesos' as const }, { titulo: 'Precio mayorista', tipo: 'pesos' as const }] : []),
  ]
  const filas = activos.map((a) => [
    a.nombre,
    a.marca,
    a.tamano,
    a.stock_actual,
    a.stock_minimo,
    ...(hayPrecios ? [a.precio_costo, a.precio_mayorista] : []),
  ])
  const valorizado = activos.reduce((t, a) => t + (a.precio_costo != null ? Math.max(a.stock_actual, 0) * a.precio_costo : 0), 0)

  return {
    titulo: 'Stock del depósito',
    subtitulo: `${local} · ${fechaHora.format(ahora)}`,
    datos: [
      ['Artículos', numero.format(activos.length)],
      ['Por debajo del mínimo', numero.format(bajos.length)],
      ...(hayPrecios ? ([['Stock valorizado a costo', textoCelda(valorizado, 'pesos')]] as [string, string][]) : []),
    ],
    secciones: [
      {
        titulo: 'Artículos',
        columnas,
        filas,
        resaltar: activos.map((a, i) => (a.bajo_minimo ? i : -1)).filter((i) => i >= 0),
        nota: bajos.length ? 'En rojo: por debajo del stock mínimo.' : undefined,
      },
    ],
    textoWhatsApp: [
      `*Stock del depósito* — ${local}`,
      fechaHora.format(ahora).replace(/ | /g, ' '),
      '',
      ...activos.map((a) => `${a.bajo_minimo ? '🔴 ' : ''}${a.nombre}: ${numero.format(a.stock_actual)} ${unidadTexto(a.unidad, a.stock_actual)}`),
    ].join('\n'),
    nombreArchivo: `deposito-${ahora.toISOString().slice(0, 10)}`,
  }
}

// ------------------------------------------------------------------ Faltantes

export function reporteFaltantes(articulos: Articulo[], local: string, ahora = new Date()): Reporte {
  const bajos = articulos
    .filter((a) => a.activo && a.bajo_minimo)
    .sort((a, b) => b.faltante - a.faltante || a.nombre.localeCompare(b.nombre, 'es'))
  const hayCosto = bajos.some((a) => a.precio_costo != null)
  const estimado = bajos.reduce((t, a) => t + (a.precio_costo != null ? a.faltante * a.precio_costo : 0), 0)

  return {
    titulo: 'Lista de faltantes',
    subtitulo: `${local} · ${fechaHora.format(ahora)}`,
    datos: [
      ['Artículos a comprar', numero.format(bajos.length)],
      ...(hayCosto ? ([['Costo estimado de la compra', textoCelda(estimado, 'pesos')]] as [string, string][]) : []),
    ],
    secciones: [
      {
        titulo: 'Qué comprar',
        columnas: [
          { titulo: 'Artículo' },
          { titulo: 'Marca' },
          { titulo: 'Tamaño' },
          { titulo: 'Hay', tipo: 'numero' },
          { titulo: 'Mínimo', tipo: 'numero' },
          { titulo: 'Comprar', tipo: 'numero' },
          ...(hayCosto ? [{ titulo: 'Costo estimado', tipo: 'pesos' as const }] : []),
        ],
        filas: bajos.map((a) => [
          a.nombre,
          a.marca,
          a.tamano,
          a.stock_actual,
          a.stock_minimo,
          a.faltante,
          ...(hayCosto ? [a.precio_costo != null ? a.faltante * a.precio_costo : null] : []),
        ]),
        nota: bajos.length === 0 ? 'No hay artículos por debajo del mínimo.' : '"Comprar" es lo que falta para llegar al stock mínimo.',
      },
    ],
    textoWhatsApp:
      bajos.length === 0
        ? `*Lista de faltantes* — ${local}\nNo hay artículos por debajo del mínimo. ✅`
        : [
            `*Lista de faltantes* — ${local}`,
            '',
            ...bajos.map((a) => `• ${a.nombre}: comprar *${numero.format(a.faltante)}* ${unidadTexto(a.unidad, a.faltante)} (hay ${numero.format(a.stock_actual)})`),
          ].join('\n'),
    nombreArchivo: `faltantes-${ahora.toISOString().slice(0, 10)}`,
  }
}

// ------------------------------------------------------------------ Resumen de evento

export function reporteEvento(detalle: DetalleEvento, articulos: ArticuloPrecio[], opciones: { incluirCostos: boolean }): Reporte {
  const { evento, barras, lineas, retiros, bebidaAbierta } = detalle
  const precios = [...articulos]
  for (const l of lineas) {
    if (!precios.some((p) => p.id === l.articulo_id)) {
      precios.push({ id: l.articulo_id, nombre: l.articulo.nombre, unidad: l.articulo.unidad, precio_costo: null, precio_mayorista: null })
    }
  }
  const lineasCalc = lineas.map((l) => ({
    barra_id: l.barra_id,
    articulo_id: l.articulo_id,
    stock_inicial: l.stock_inicial,
    stock_final: l.stock_final,
    reposiciones: l.reposiciones,
  }))
  const botellas = soloBotellas(retiros)
  const tipo: TipoBarra = evento.tipo_barra ?? 'propia'
  const precio = TIPOS_BARRA[tipo].precio
  const resumen = resumirEvento(lineasCalc, botellas, precios, evento.personas, tipo)
  const costos = costosDelEvento(barras, lineasCalc, botellas, precios, tipo)
  const tragos = tragosRetirados(retiros)
  const abierta = bebidaAbiertaPorArticulo(bebidaAbierta)
  const nombreAbierta = (id: string) => bebidaAbierta.find((b) => b.articulo_id === id)?.articulo?.nombre ?? '¿?'
  const nombreBarra = (id: string) => barras.find((b) => b.id === id)?.nombre ?? 'Barra'

  const secciones: Seccion[] = []

  secciones.push({
    titulo: 'Consumo total por artículo',
    columnas: [
      { titulo: 'Artículo' },
      { titulo: 'Consumido', tipo: 'numero' },
      { titulo: 'Personal', tipo: 'numero' },
      { titulo: 'Cortesías', tipo: 'numero' },
      { titulo: 'Venta estimada', tipo: 'numero' },
      { titulo: 'Por persona', tipo: 'numero' },
    ],
    filas: resumen.filas.map((f) => [
      f.articulo.nombre + (f.pendiente ? ' (falta final)' : ''),
      f.consumido,
      f.retirosPersonal,
      f.cortesias,
      f.ventaEstimada,
      f.porPersona == null ? null : Math.round(f.porPersona * 100) / 100,
    ]),
    resaltar: resumen.filas.map((f, i) => (f.pendiente || f.ventaEstimada < 0 ? i : -1)).filter((i) => i >= 0),
    nota:
      resumen.barrasSinFinal > 0
        ? `Falta cargar el stock final en ${resumen.barrasSinFinal} artículo(s): no se cuentan en el consumo.`
        : 'Venta estimada = Consumido - Retiros de personal - Cortesías.',
  })

  for (const b of barras) {
    const ls = lineas.filter((l) => l.barra_id === b.id)
    if (!opciones.incluirCostos) {
      secciones.push({
        titulo: b.nombre,
        columnas: [
          { titulo: 'Artículo' },
          { titulo: 'Stock inicial', tipo: 'numero' },
          { titulo: 'Reposiciones', tipo: 'numero' },
          { titulo: 'Stock final', tipo: 'numero' },
          { titulo: 'Consumido', tipo: 'numero' },
        ],
        filas: ls.map((l) => [l.articulo.nombre, l.stock_inicial, totalReposiciones(l), l.stock_final, consumido(l)]),
        nota: ls.length === 0 ? 'Sin artículos.' : undefined,
      })
      continue
    }
    // Con precios: la cuenta completa de la barra, de lo consumido al total
    const cb = costos.barras.find((x) => x.barra_id === b.id)
    const filaCosto = (articuloId: string) => cb?.filas.find((f) => f.articulo.id === articuloId)
    secciones.push({
      titulo: b.nombre,
      columnas: [
        { titulo: 'Artículo' },
        { titulo: 'Stock inicial', tipo: 'numero' },
        { titulo: 'Reposiciones', tipo: 'numero' },
        { titulo: 'Stock final', tipo: 'numero' },
        { titulo: 'Consumido', tipo: 'numero' },
        { titulo: precio.charAt(0).toUpperCase() + precio.slice(1), tipo: 'pesos' },
        { titulo: 'Total', tipo: 'pesos' },
      ],
      filas: ls.map((l) => {
        const f = filaCosto(l.articulo_id)
        return [
          l.articulo.nombre,
          l.stock_inicial,
          totalReposiciones(l),
          l.stock_final,
          consumido(l),
          f?.precio ?? null,
          f?.total ?? null,
        ]
      }),
      resaltar: ls.map((l, i) => (l.stock_final == null ? i : -1)).filter((i) => i >= 0),
      total: ls.length ? [`Total ${b.nombre}`, null, null, null, null, null, cb?.total ?? 0] : undefined,
      nota:
        ls.length === 0
          ? 'Sin artículos.'
          : `Consumido = Stock inicial + Reposiciones - Stock final. Total = Consumido x ${precio} (${TIPOS_BARRA[tipo].nombre.toLowerCase()}).` +
            (ls.some((l) => l.stock_final == null) ? ' En rojo: falta el stock final (no se cuenta).' : ''),
    })
  }

  const personal = detalleRetiros(retiros, 'personal')
  const cortesias = detalleRetiros(retiros, 'cortesia')
  for (const [titulo, d] of [
    ['Retiros de personal', personal],
    ['Cortesías', cortesias],
  ] as const) {
    if (d.cantidadRetiros === 0) continue
    secciones.push({
      titulo,
      columnas: [{ titulo: 'Quién retiró' }, { titulo: 'Qué' }, { titulo: 'Cantidad', tipo: 'numero' }, { titulo: 'Medida' }, { titulo: 'Barra' }, { titulo: 'Hora' }],
      filas: d.lista.map((r) => [
        r.retirado_por,
        r.articulo?.nombre ?? r.trago?.nombre ?? '¿?',
        r.cantidad,
        r.trago_id ? (r.cantidad === 1 ? 'vaso' : 'vasos') : unidadTexto(r.articulo?.unidad ?? 'unidad', r.cantidad),
        nombreBarra(r.barra_id),
        fechaHora.format(new Date(r.hora)).replace(/\u00a0|\u202f/g, ' '),
      ]),
      total: [`Total: ${d.cantidadRetiros} ${d.cantidadRetiros === 1 ? 'retiro' : 'retiros'}`, null, null, textoTotalRetiros(d), null, null],
    })
  }

  if (tragos.length > 0) {
    secciones.push({
      titulo: 'Tragos y vasos retirados',
      columnas: [{ titulo: 'Trago / vaso' }, { titulo: 'Personal', tipo: 'numero' }, { titulo: 'Cortesía', tipo: 'numero' }, { titulo: 'Total vasos', tipo: 'numero' }],
      filas: tragos.map((t) => [t.nombre, t.personal, t.cortesia, t.vasos]),
      nota: 'Informativo: salen de las botellas de las barras.',
    })
  }

  if (abierta.size > 0) {
    secciones.push({
      titulo: 'Bebida abierta',
      columnas: [{ titulo: 'Artículo' }, { titulo: 'Botellas' }],
      filas: [...abierta.entries()]
        .sort((a, b) => nombreAbierta(a[0]).localeCompare(nombreAbierta(b[0]), 'es'))
        .map(([id, n]) => [nombreAbierta(id), formatoBotellas(n)]),
      nota: 'Solo informativa: no sale del depósito.',
    })
  }

  if (opciones.incluirCostos) {
    secciones.push({
      titulo: 'Costos',
      columnas: [{ titulo: 'Barra' }, { titulo: `Total a ${precio}`, tipo: 'pesos' }],
      filas: costos.barras.map((b) => [nombreBarra(b.barra_id), b.total]),
      total: ['Total general', costos.total],
      nota:
        'El detalle de cada barra (cantidades consumidas, precios y totales por artículo) está en la sección de cada barra.' +
        `${TIPOS_BARRA[tipo].nombre}: se calcula con ${precio}.` +
        (costos.sinPrecio.length ? ` Sin ${precio} (no se suman): ${costos.sinPrecio.join(', ')}.` : ''),
    })
  }

  // Caja (si se cargó algo)
  const hayCaja = cajaCargada(detalle.caja, detalle.gastos)
  const caja = calcularCaja(detalle.caja ?? CAJA_VACIA, detalle.gastos)
  if (hayCaja) {
    const c = detalle.caja ?? CAJA_VACIA
    secciones.push({
      titulo: 'Caja',
      columnas: [{ titulo: 'Concepto' }, { titulo: 'Monto', tipo: 'pesos' }],
      filas: [
        ['Barras · Efectivo real', c.efectivo_real],
        ['Barras · Efectivo sistema', c.efectivo_sistema],
        ['Barras · Diferencia efectivo', caja.diferenciaEfectivo],
        ['Barras · Cierre de lotes', c.cierre_lotes],
        ['Barras · Tarjetas sistema', c.tarjetas_sistema],
        ['Barras · Diferencia tarjetas', caja.diferenciaTarjetas],
        ['VENTA TOTAL CAJA (barras)', caja.ventaCaja],
        ['Boletería · Efectivo real', c.boleteria_efectivo],
        ['Boletería · Cierre de lotes', c.boleteria_lotes],
        ['TOTAL BOLETERÍA', caja.totalBoleteria],
        ['Guardarropas · Efectivo real', c.guardarropas_efectivo],
        ['Guardarropas · Cierre de lotes', c.guardarropas_lotes],
        ['TOTAL GUARDARROPAS', caja.totalGuardarropas],
        ['GASTOS TOTALES', caja.totalGastos],
        ['Cambio disponible próxima caja', c.cambio_proxima_caja],
        ['RETIRO A CAJA FUERTE', caja.retiroCajaFuerte],
      ],
      resaltar: [
        ...(caja.diferenciaEfectivo < 0 ? [2] : []),
        ...(caja.diferenciaTarjetas < 0 ? [5] : []),
        ...(caja.retiroCajaFuerte < 0 ? [15] : []),
      ],
      total: ['VENTA TOTAL + BOLETERÍA + GUARDARROPAS', caja.ventaTotalGeneral],
      nota:
        `Vasos no devueltos: ${c.vasos_no_devueltos ?? 0}. ` +
        'Diferencia = real - sistema (negativo: falta plata). Retiro a caja fuerte = todo el efectivo (barras + boletería + guardarropas) - gastos - cambio para la próxima caja.',
    })
    if (detalle.gastos.length) {
      secciones.push({
        titulo: 'Gastos de la noche',
        columnas: [{ titulo: 'Detalle' }, { titulo: 'Monto', tipo: 'pesos' }, { titulo: 'Hora' }],
        filas: detalle.gastos.map((g) => [g.detalle, g.monto, fechaHora.format(new Date(g.hora)).replace(/\u00a0|\u202f/g, ' ')]),
        total: ['Total gastos', caja.totalGastos, null],
      })
    }
  }

  const datos: [string, string][] = [
    ['Fecha', fechaEvento(evento.fecha)],
    ['Personas', numero.format(evento.personas)],
    ['Barras', numero.format(barras.length)],
    ['Retiros de personal', personal.cantidadRetiros ? `${personal.cantidadRetiros} (${textoTotalRetiros(personal)})` : '0'],
    ['Cortesías', cortesias.cantidadRetiros ? `${cortesias.cantidadRetiros} (${textoTotalRetiros(cortesias)})` : '0'],
  ]
  if (opciones.incluirCostos) {
    datos.push(['Tipo de barra', `${TIPOS_BARRA[tipo].nombre} (${precio})`], [`Total a ${precio}`, textoCelda(costos.total, 'pesos')])
  }
  if (hayCaja) {
    datos.push(['Venta total + boletería + guardarropas', textoCelda(caja.ventaTotalGeneral, 'pesos')], ['Retiro a caja fuerte', textoCelda(caja.retiroCajaFuerte, 'pesos')])
  }

  const lineasWa = [
    `*${evento.nombre}*`,
    `${fechaEvento(evento.fecha)} · ${numero.format(evento.personas)} personas`,
    '',
    '*Consumo total*',
    ...resumen.filas.map(
      (f) =>
        `• ${f.articulo.nombre}: ${numero.format(f.consumido)} ${unidadTexto(f.articulo.unidad, f.consumido)}` +
        (f.retirosPersonal + f.cortesias > 0 ? ` (venta ${numero.format(f.ventaEstimada)})` : '') +
        (f.pendiente ? ' ⚠ falta final' : ''),
    ),
  ]
  for (const [titulo, d] of [
    ['Retiros de personal', personal],
    ['Cortesías', cortesias],
  ] as const) {
    if (d.cantidadRetiros === 0) continue
    lineasWa.push('', `*${titulo}* (${textoTotalRetiros(d)})`)
    for (const r of d.lista) {
      const cuanto = r.trago_id ? `${r.cantidad} ${r.cantidad === 1 ? 'vaso' : 'vasos'}` : `${r.cantidad} ${unidadTexto(r.articulo?.unidad ?? 'unidad', r.cantidad)}`
      lineasWa.push(`• ${r.retirado_por}: ${r.articulo?.nombre ?? r.trago?.nombre} ${cuanto}`)
    }
  }
  if (abierta.size) lineasWa.push(`Bebida abierta: ${[...abierta.entries()].map(([id, n]) => `${nombreAbierta(id)} ${formatoBotellas(n)}`).join(', ')}`)
  if (opciones.incluirCostos) {
    lineasWa.push('', `${TIPOS_BARRA[tipo].nombre}`, `*Total a ${precio}:* ${textoCelda(costos.total, 'pesos')}`)
  }

  if (hayCaja) {
    lineasWa.push(
      '',
      '*Caja*',
      `Venta caja barras: ${textoCelda(caja.ventaCaja, 'pesos')}`,
      `Diferencia efectivo: ${textoCelda(caja.diferenciaEfectivo, 'pesos')} · Diferencia tarjetas: ${textoCelda(caja.diferenciaTarjetas, 'pesos')}`,
      `Boletería: ${textoCelda(caja.totalBoleteria, 'pesos')} · Guardarropas: ${textoCelda(caja.totalGuardarropas, 'pesos')}`,
      `Gastos: ${textoCelda(caja.totalGastos, 'pesos')}`,
      `*Venta total + boletería + guardarropas:* ${textoCelda(caja.ventaTotalGeneral, 'pesos')}`,
      `*Retiro a caja fuerte:* ${textoCelda(caja.retiroCajaFuerte, 'pesos')}`,
    )
  }

  return {
    titulo: evento.nombre,
    subtitulo: `Resumen del evento · ${fechaEvento(evento.fecha)}`,
    datos,
    secciones,
    textoWhatsApp: lineasWa.join('\n'),
    nombreArchivo: `evento-${slug(evento.nombre)}-${evento.fecha}`,
  }
}

// ------------------------------------------------------------------ Caja fuerte: resumen mensual

export function reporteCajaFuerteMes(
  m: { anio: number; mes: number; saldo_inicial: number; efectivo: number; gastos: number; retiros: number; ingresos: number; saldo_final: number; renglones: RenglonResumen[] },
  local: string,
  estado: string,
): Reporte {
  const nombre = `${nombreMes(m.mes)} ${m.anio}`
  const fecha = (f: string) => (f.length === 10 ? f.split('-').reverse().join('/') : f.slice(0, 10).split('-').reverse().join('/') + ' ' + f.slice(11, 16))
  return {
    titulo: `Caja fuerte · ${nombre}`,
    subtitulo: `${local} · ${estado}`,
    datos: [
      ['Saldo al empezar el mes', textoCelda(m.saldo_inicial, 'pesos')],
      ['Saldo al cierre del mes', textoCelda(m.saldo_final, 'pesos')],
    ],
    secciones: [
      {
        titulo: 'Resumen del mes',
        columnas: [{ titulo: 'Concepto' }, { titulo: 'Monto', tipo: 'pesos' }],
        filas: [
          ['Saldo al empezar el mes', m.saldo_inicial],
          ['+ Efectivo real de eventos', m.efectivo],
          ['- Gastos de eventos', m.gastos],
          ['- Retiros', m.retiros],
          ['+ Ingresos manuales', m.ingresos],
        ],
        total: ['= Saldo al cierre del mes', m.saldo_final],
      },
      {
        titulo: 'Movimientos',
        columnas: [{ titulo: 'Fecha' }, { titulo: 'Concepto' }, { titulo: 'Detalle' }, { titulo: 'Monto', tipo: 'pesos' }, { titulo: 'Saldo', tipo: 'pesos' }],
        filas: m.renglones.map((r) => [fecha(r.fecha), r.titulo, r.detalle, r.monto, r.saldo]),
        resaltar: m.renglones.map((r, i) => (r.monto < 0 ? i : -1)).filter((i) => i >= 0),
        nota: m.renglones.length === 0 ? 'Sin movimientos en el mes.' : 'En rojo: lo que salió de la caja fuerte (gastos y retiros).',
      },
      ...(m.renglones.some((r) => r.items?.length)
        ? [
            {
              titulo: 'Detalle de gastos',
              columnas: [{ titulo: 'Fecha' }, { titulo: 'Evento' }, { titulo: 'Para qué fue' }, { titulo: 'Monto', tipo: 'pesos' as const }],
              filas: m.renglones.flatMap((r) => (r.items ?? []).map((g) => [fecha(r.fecha), r.detalle, g.detalle, g.monto] as Celda[])),
              total: ['Total gastos', null, null, m.gastos] as Celda[],
            },
          ]
        : []),
    ],
    textoWhatsApp: [
      `*Caja fuerte · ${nombre}*`,
      `Saldo al empezar: ${textoCelda(m.saldo_inicial, 'pesos')}`,
      `+ Efectivo de eventos: ${textoCelda(m.efectivo, 'pesos')}`,
      `− Gastos de eventos: ${textoCelda(m.gastos, 'pesos')}`,
      ...m.renglones.flatMap((r) => (r.items ?? []).map((g) => `   • ${r.detalle}: ${g.detalle} ${textoCelda(g.monto, 'pesos')}`)),
      `− Retiros: ${textoCelda(m.retiros, 'pesos')}`,
      `+ Ingresos: ${textoCelda(m.ingresos, 'pesos')}`,
      `*Saldo al cierre: ${textoCelda(m.saldo_final, 'pesos')}*`,
    ].join('\n'),
    nombreArchivo: `caja-fuerte-${m.anio}-${String(m.mes).padStart(2, '0')}`,
  }
}
