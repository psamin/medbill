'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getUser, clearSession } from '@/lib/auth'
import { api } from '@/lib/api'
import type { User } from '@/types/auth'

interface NavItem {
  href: string
  label: string
}

const NAV_LINKS: Record<string, NavItem[]> = {
  law_firm: [
    { href: '/dashboard',            label: 'Dashboard' },
    { href: '/cases',                label: 'Cases' },
    { href: '/funding-batches',      label: 'Funding Batches' },
    { href: '/negotiated-cpt-rates', label: 'CPT Rates' },
    { href: '/assignments',          label: 'Assignments' },
  ],
  provider: [
    { href: '/dashboard',       label: 'Dashboard' },
    { href: '/cases',           label: 'Assigned Cases' },
    { href: '/funding-batches', label: 'Funding Batches' },
  ],
  funder: [
    { href: '/dashboard',       label: 'Dashboard' },
    { href: '/funding-batches', label: 'Batch Queue' },
  ],
  admin: [
    { href: '/dashboard',            label: 'Dashboard' },
    { href: '/cases',                label: 'Cases' },
    { href: '/funding-batches',      label: 'Funding Batches' },
    { href: '/negotiated-cpt-rates', label: 'CPT Rates' },
    { href: '/assignments',          label: 'Assignments' },
  ],
}

function NavLink({ href, label }: NavItem) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
  return (
    <Link
      href={href}
      className={`flex items-center px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-50 text-blue-700 font-medium'
          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
      }`}
    >
      {label}
    </Link>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    setUser(getUser())
  }, [])

  async function handleLogout() {
    try { await api.post('/api/auth/logout') } catch { /* ignore */ }
    clearSession()
    router.push('/login')
  }

  const links = (mounted && user) ? (NAV_LINKS[user.role] ?? NAV_LINKS.law_firm) : []
  const roleLabel = user?.role.replace('_', ' ') ?? ''

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Sidebar — sticky full-height, never scrolls */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col flex-shrink-0 sticky top-0 h-screen">
        {/* Brand */}
        <div className="px-5 py-5 border-b border-gray-100">
          <Link href="/dashboard" className="text-lg font-bold text-gray-900 tracking-tight">
            MedBill
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {links.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </nav>

        {/* User / Logout */}
        {mounted && user && (
          <div className="px-4 py-4 border-t border-gray-100">
            <div className="mb-2">
              <p className="text-xs font-medium text-gray-900 truncate">
                {user.organization_name || user.email}
              </p>
              <p className="text-xs text-gray-400 capitalize">{roleLabel}</p>
            </div>
            <button
              onClick={handleLogout}
              className="text-xs text-gray-400 hover:text-red-600 transition-colors"
            >
              Log out
            </button>
          </div>
        )}
      </aside>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
