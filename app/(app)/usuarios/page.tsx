'use client'

import { useState } from 'react'
import { RolesYPermisos } from '@/components/usuarios/Roles'
import { ListaUsuarios } from '@/components/usuarios/Usuarios'
import { Aviso, cx } from '@/components/ui'
import { useSesion } from '@/lib/sesion'

export default function PaginaUsuarios() {
  const { puede } = useSesion()
  const [pestana, setPestana] = useState<'usuarios' | 'roles'>('usuarios')

  if (!puede('usuarios.gestionar')) return <Aviso>No tenés permiso para gestionar usuarios.</Aviso>

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Usuarios</h1>
      <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-borde bg-superficie p-1 text-sm sm:w-96">
        {(
          [
            ['usuarios', 'Usuarios'],
            ['roles', 'Roles y permisos'],
          ] as const
        ).map(([p, t]) => (
          <button key={p} onClick={() => setPestana(p)} className={cx('rounded-md py-2', pestana === p ? 'plata font-semibold' : 'text-suave hover:bg-realce')}>
            {t}
          </button>
        ))}
      </div>
      {pestana === 'usuarios' ? <ListaUsuarios /> : <RolesYPermisos />}
    </div>
  )
}
