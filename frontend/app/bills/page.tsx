'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '@/components/Navbar'
import BillTable from '@/components/BillTable'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import type { MedicalBill } from '@/types/billing'
import type { User } from '@/types/auth'

interface BillsResponse {
  success: boolean
  data: MedicalBill[]
}

const TITLE: Record<string, string> = {
  law_firm: 'My Bills',
  funder:   'Funding Queue',
  provider: 'My Uploads',
  admin:    'All Bills',
}

const SUBTITLE: Record<string, string> = {
  law_firm: 'All bills across your cases',
  funder:   'Bills awaiting your funding review',
  provider: 'Bills you have uploaded',
  admin:    'All bills in the system',
}

export default function BillsPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [bills, setBills] = useState<MedicalBill[]>([])
  const [loading, setLoading] = useState(true)

  const fetchBills = useCallback(async () => {
    try {
      const res = await api.get<BillsResponse>('/api/bills')
      setBills(res.data)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    const u = getUser()
    setUser(u)
    fetchBills()
  }, [router, fetchBills])

  const role = user?.role ?? 'law_firm'

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-900">{TITLE[role]}</h1>
            <p className="mt-1 text-sm text-gray-500">
              {!loading && `${bills.length} bill${bills.length !== 1 ? 's' : ''} · `}
              {SUBTITLE[role]}
            </p>
          </div>

          {loading ? (
            <div className="text-center py-12 text-sm text-gray-400">Loading…</div>
          ) : (
            <BillTable bills={bills} />
          )}
        </div>
      </main>
    </>
  )
}
