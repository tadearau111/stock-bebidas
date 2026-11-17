// Convierte los registros técnicos del historial en frases entendibles.

export interface RegistroAuditoria {
  id: number
  tabla: string
  registro_id: string
  accion: 'alta' | 'modificacion' | 'baja'
  cambios: Record<string, { antes: unknown; despues: unknown }>
  usuario_id: string | null
  fecha: string
  articulo_id: string | null
  evento_id: string | null
}

export interface Nombres {
  usuarios: Map<string, string>
  articulos: Map<string, string>
  eventos: Map<string, string>
  roles: Map<string, string>
  tragos?: Map<string, string>
  proveedores?: Map<string, string>
}

const SUJETOS: Record<string, string> = {
  articulos: 'artículo',
  tragos: 'trago o vaso',
  proveedores: 'proveedor',
  evento_caja: 'caja del evento',
  evento_gastos: 'gasto de la noche',
  movimientos: 'movimiento del depósito',
  eventos: 'evento',
  barras: 'barra',
  barra_articulos: 'artículo de barra',
  reposiciones: 'reposición',
  retiros: 'retiro',
  bebida_abierta: 'bebida abierta',
  evento_asignaciones: 'asignación de evento',
  perfiles: 'usuario',
  miembros: 'acceso de usuario',
  roles: 'rol',
  rol_permisos: 'permiso de rol',
}

export const AREAS: Record<string, string[]> = {
  'Depósito y artículos': ['articulos', 'movimientos', 'tragos', 'proveedores'],
  Eventos: ['eventos', 'barras', 'barra_articulos', 'reposiciones', 'retiros', 'bebida_abierta', 'evento_asignaciones'],
  Caja: ['evento_caja', 'evento_gastos'],
  'Usuarios y permisos': ['perfiles', 'miembros', 'roles', 'rol_permisos'],
}

const CAMPOS: Record<string, string> = {
  nombre: 'Nombre',
  marca: 'Marca',
  tamano: 'Tamaño',
  unidad: 'Se cuenta por',
  stock_minimo: 'Stock mínimo',
  precio_costo: 'Precio de costo',
  precio_venta: 'Precio de venta',
  activo: 'Activo',
  tipo: 'Tipo',
  cantidad: 'Cantidad',
  motivo: 'Motivo',
  fecha: 'Fecha',
  personas: 'Personas',
  notas: 'Notas',
  orden: 'Orden',
  stock_inicial: 'Stock inicial',
  stock_final: 'Stock final',
  hora: 'Hora',
  retirado_por: 'Quién retiró',
  cuartos: 'Fracción',
  email: 'Email',
  descripcion: 'Descripción',
  rol_id: 'Rol',
  usuario_id: 'Usuario',
  articulo_id: 'Artículo',
  trago_id: 'Trago',
  proveedor_id: 'Proveedor',
  evento_id: 'Evento',
  permiso_codigo: 'Permiso',
  efectivo_real: 'Efectivo real',
  efectivo_sistema: 'Efectivo sistema',
  cierre_lotes: 'Cierre de lotes',
  tarjetas_sistema: 'Tarjetas sistema',
  boleteria_efectivo: 'Boletería efectivo',
  boleteria_lotes: 'Boletería cierre de lotes',
  guardarropas_efectivo: 'Guardarropas efectivo',
  guardarropas_lotes: 'Guardarropas cierre de lotes',
  cambio_proxima_caja: 'Cambio próxima caja',
  vasos_no_devueltos: 'Vasos no devueltos',
  monto: 'Monto',
  detalle: 'Detalle',
}

// Columnas técnicas que no aportan nada a quien lee
const OCULTAS = new Set(['id', 'local_id', 'creado_por', 'barra_id', 'barra_articulo_id', 'es_sistema', 'actualizado_por'])

const VALORES: Record<string, Record<string, string>> = {
  tipo: { ingreso: 'Ingreso', ajuste: 'Ajuste', personal: 'Personal', cortesia: 'Cortesía', detalle: 'Detallada', total: 'Total directo' },
  unidad: { unidad: 'Unidad', bolsa: 'Bolsa' },
  cuartos: { '1': '¼', '2': '½', '3': '¾', '4': 'Entera' },
}

const fmtFechaHora = new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const CAMPOS_PESOS = new Set([
  'precio_costo', 'precio_venta', 'efectivo_real', 'efectivo_sistema', 'cierre_lotes', 'tarjetas_sistema',
  'boleteria_efectivo', 'boleteria_lotes', 'guardarropas_efectivo', 'guardarropas_lotes', 'cambio_proxima_caja', 'monto',
])

export function formatoValor(campo: string, valor: unknown, nombres?: Nombres): string {
  if (valor == null || valor === '') return '—'
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No'
  const texto = String(valor)
  if (VALORES[campo]?.[texto]) return VALORES[campo][texto]
  if (nombres) {
    if (campo === 'usuario_id') return nombres.usuarios.get(texto) ?? 'usuario'
    if (campo === 'articulo_id') return nombres.articulos.get(texto) ?? 'artículo'
    if (campo === 'evento_id') return nombres.eventos.get(texto) ?? 'evento'
    if (campo === 'rol_id') return nombres.roles.get(texto) ?? 'rol'
    if (campo === 'trago_id') return nombres.tragos?.get(texto) ?? 'trago'
    if (campo === 'proveedor_id') return nombres.proveedores?.get(texto) ?? 'proveedor'
  }
  if (campo === 'hora' || (campo === 'fecha' && texto.includes('T'))) return fmtFechaHora.format(new Date(texto))
  if (campo === 'fecha' && /^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto.split('-').reverse().join('/')
  if (CAMPOS_PESOS.has(campo) && !Number.isNaN(Number(texto))) {
    return '$ ' + Number(texto).toLocaleString('es-AR', { maximumFractionDigits: 2 })
  }
  return texto
}

export interface Cambio {
  campo: string
  antes: string
  despues: string
}

export interface Descripcion {
  titulo: string // "modificó el artículo de barra"
  cambios: Cambio[]
}

export function describir(r: RegistroAuditoria, nombres?: Nombres): Descripcion {
  const sujeto = SUJETOS[r.tabla] ?? r.tabla
  const verbo = r.accion === 'alta' ? 'cargó' : r.accion === 'baja' ? 'borró' : 'modificó'
  let titulo = `${verbo} ${articulo(sujeto)} ${sujeto}`

  // Casos con frases más naturales
  const tipoMov = (r.cambios.tipo?.despues ?? r.cambios.tipo?.antes) as string | undefined
  if (r.tabla === 'movimientos' && tipoMov) titulo = `${verbo} un ${tipoMov === 'ingreso' ? 'ingreso' : 'ajuste'} de stock`
  if (r.tabla === 'perfiles' && r.cambios.activo && r.accion === 'modificacion') {
    titulo = r.cambios.activo.despues ? 'reactivó un usuario' : 'desactivó un usuario'
  }
  if (r.tabla === 'perfiles' && r.accion === 'alta') titulo = 'se creó un usuario'
  if (r.tabla === 'articulos' && r.cambios.activo && r.accion === 'modificacion' && Object.keys(r.cambios).length === 1) {
    titulo = r.cambios.activo.despues ? 'reactivó un artículo' : 'desactivó un artículo'
  }

  const cambios = Object.entries(r.cambios)
    .filter(([campo]) => !OCULTAS.has(campo))
    .filter(([campo]) => !(r.tabla === 'articulos' && campo === 'articulo_id'))
    .map(([campo, v]) => ({
      campo: CAMPOS[campo] ?? campo,
      antes: formatoValor(campo, v.antes, nombres),
      despues: formatoValor(campo, v.despues, nombres),
    }))

  return { titulo, cambios }
}

function articulo(sujeto: string) {
  return /^(reposición|barra|asignación|bebida)/.test(sujeto) ? 'una' : 'un'
}
