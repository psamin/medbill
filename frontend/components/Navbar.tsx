'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getUser, clearSession } from '@/lib/auth'
import { api } from '@/lib/api'
import type { User } from '@/types/auth'

function NavLink({ href, label }: { href: string; label: string }) {
  const pathname = usePathname()
  const active = pathname === href || pathname.startsWith(href + '/')
  return (
    <Link
      href={href}
      className={`text-sm transition-colors ${
        active ? 'text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-900'
      }`}
    >
      {label}
    </Link>
  )
}

export default function Navbar() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    setUser(getUser())
  }, [])

  async function handleLogout() {
    try { await api.post('/api/auth/logout') } catch { /* ignore */ }
    clearSession()
    router.push('/login')
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-semibold text-gray-900">
          MedBill
        </Link>

        <div className="flex items-center gap-6">
          {/* law_firm + admin + provider */}
          {user && user.role !== 'funder' && (
            <NavLink href="/cases" label="Cases" />
          )}

          {/* everyone sees bills — label changes per role */}
          {user && (
            <NavLink
              href="/bills"
              label={user.role === 'funder' ? 'Funding Queue' : 'Bills'}
            />
          )}

          {/* only roles that can upload */}
          {user && ['law_firm', 'provider', 'admin'].includes(user.role) && (
            <NavLink href="/upload" label="Upload" />
          )}

          {user && (
            <div className="flex items-center gap-4 pl-4 border-l border-gray-200">
              <div className="text-right">
                <p className="text-xs font-medium text-gray-900 leading-tight">
                  {user.organization_name || user.email}
                </p>
                <p className="text-xs text-gray-400 capitalize leading-tight">
                  {user.role.replace('_', ' ')}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-400 hover:text-red-600 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  )
}
