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

function NavLink({ href, label, onClick }: NavItem & { onClick?: () => void }) {
  const pathname = usePathname()
  const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href + '/'))
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`flex items-center px-3 py-2.5 rounded-lg text-sm transition-colors ${
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
  const pathname = usePathname()
  const [user, setUser] = useState<User | null>(null)
  const [mounted, setMounted] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    setMounted(true)
    setUser(getUser())
  }, [])

  // Close sidebar on route change
  useEffect(() => {
    setSidebarOpen(false)
  }, [pathname])

  async function handleLogout() {
    try { await api.post('/api/auth/logout') } catch { /* ignore */ }
    clearSession()
    router.push('/login')
  }

  const links = (mounted && user) ? (NAV_LINKS[user.role] ?? NAV_LINKS.law_firm) : []
  const roleLabel = user?.role.replace('_', ' ') ?? ''

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100 flex items-center justify-between">
        <Link href="/dashboard" className="text-lg font-bold text-gray-900 tracking-tight" onClick={() => setSidebarOpen(false)}>
          MedBill
        </Link>
        {/* Close button — mobile only */}
        <button
          className="lg:hidden p-1 rounded text-gray-400 hover:text-gray-700"
          onClick={() => setSidebarOpen(false)}
          aria-label="Close menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {links.map((item) => (
          <NavLink key={item.href} {...item} onClick={() => setSidebarOpen(false)} />
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
    </>
  )

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — drawer on mobile, sticky column on desktop */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col flex-shrink-0
        transition-transform duration-200 ease-in-out
        lg:w-56 lg:translate-x-0 lg:sticky lg:top-0 lg:h-screen
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {sidebarContent}
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {/* Mobile top bar */}
        <div className="lg:hidden bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-30">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-base font-bold text-gray-900">MedBill</span>
        </div>

        {children}
      </div>
    </div>
  )
}
