'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import LawFirmDashboard from '@/components/dashboards/LawFirmDashboard'
import ProviderDashboard from '@/components/dashboards/ProviderDashboard'
import FunderDashboard from '@/components/dashboards/FunderDashboard'
import { isAuthenticated, getUser } from '@/lib/auth'
import type { User } from '@/types/auth'

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
  }, [router])

  if (!user) return null

  const content = (() => {
    switch (user.role) {
      case 'funder': return <FunderDashboard user={user} />
      case 'provider': return <ProviderDashboard user={user} />
      default: return <LawFirmDashboard user={user} />
    }
  })()

  return <AppShell>{content}</AppShell>
}
