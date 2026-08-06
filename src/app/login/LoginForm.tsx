'use client'

import { useActionState } from 'react'
import { loginAction } from './actions'
import { Bot } from 'lucide-react'

export default function LoginForm() {
  const [state, formAction, isPending] = useActionState(loginAction, null)

  return (
    <div className="min-h-screen bg-neutral-950 flex flex-col justify-center items-center p-4 font-sans text-neutral-100">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-2xl mx-auto flex items-center justify-center shadow-lg shadow-blue-900/20 mb-4">
            <Bot size={32} className="text-white" />
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">Copiloto</h1>
          <p className="text-neutral-400 mt-2">Inicia sesión para entrar al Motor de Realidad</p>
        </div>

        <form action={formAction} className="bg-neutral-900/50 backdrop-blur-xl border border-neutral-800 p-8 rounded-3xl shadow-2xl">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">Correo Electrónico</label>
              <input
                name="email"
                type="email"
                required
                className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl px-4 py-3 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="anton@empresa.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-neutral-300 mb-1.5">Contraseña</label>
              <input
                name="password"
                type="password"
                required
                className="w-full bg-neutral-800/50 border border-neutral-700 rounded-xl px-4 py-3 text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="••••••••"
              />
            </div>
          </div>

          {state?.error && (
            <div className="mt-4 p-3 bg-red-950/30 border border-red-900/50 text-red-400 text-sm rounded-xl text-center">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium py-3 rounded-xl mt-8 shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50"
          >
            {isPending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
