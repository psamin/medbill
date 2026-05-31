'use client'

import { use, useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import AppShell from '@/components/AppShell'
import StatusBadge from '@/components/StatusBadge'
import BillTable from '@/components/BillTable'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { PatientCase } from '@/types/cases'
import type { MedicalBill } from '@/types/billing'
import type { User } from '@/types/auth'

type CaseDetail = PatientCase & { bills: MedicalBill[] }
interface CaseDetailResponse { success: boolean; data: CaseDetail }
interface Props { params: Promise<{ caseId: string }> }

export default function CaseDetailPage({ params }: Props) {
  const { caseId } = use(params)
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [caseData, setCaseData] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<CaseDetailResponse>(`/api/cases/${caseId}`)
      .then(res => setCaseData(res.data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load case'))
      .finally(() => setLoading(false))
  }, [caseId, router])

  if (loading) return (
    <AppShell><main className="p-8"><div className="text-sm text-gray-400 text-center py-12">Loading…</div></main></AppShell>
  )
  if (error || !caseData) return (
    <AppShell><main className="p-8">
      <Link href="/cases" className="text-sm text-blue-600 hover:text-blue-700">← Cases</Link>
      <p className="mt-4 text-sm text-red-600">{error || 'Case not found'}</p>
    </main></AppShell>
  )

  const canUpload = user?.role !== 'funder'

  return (
    <AppShell>
      <main className="p-8">
        <div className="mb-6">
          <Link href="/cases" className="text-sm text-blue-600 hover:text-blue-700">← Cases</Link>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-gray-900">{caseData.patient_name}</h1>
                <StatusBadge status={caseData.status} />
              </div>
              <p className="mt-1 text-sm text-gray-500">Case #{caseData.case_number}</p>
              <p className="mt-1 text-xs text-gray-400">Created {formatDate(caseData.created_at)}</p>
            </div>
            {canUpload && (
              <Link
                href={`/upload?caseId=${caseData.id}`}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                Upload Bill
              </Link>
            )}
          </div>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Billed</p>
              <p className="mt-1 text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(caseData.total_billed_amount)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Medicare Value</p>
              <p className="mt-1 text-xl font-semibold text-gray-900 tabular-nums">{formatCurrency(caseData.total_medicare_amount)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <p className="text-xs text-green-600 uppercase tracking-wide">Total Savings</p>
              <p className="mt-1 text-xl font-semibold text-green-700 tabular-nums">{formatCurrency(caseData.total_savings)}</p>
            </div>
          </div>
        </div>

        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Bills <span className="text-sm font-normal text-gray-400">({caseData.bills.length})</span>
          </h2>
          <BillTable bills={caseData.bills} userRole={user?.role} />
        </div>
      </main>
    </AppShell>
  )
}
