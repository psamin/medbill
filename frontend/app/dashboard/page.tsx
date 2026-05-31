'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import MetricCard from '@/components/MetricCard'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatCurrency } from '@/lib/formatters'
import type { User } from '@/types/auth'

interface DashboardSummary {
  total_cases: number
  total_billed: string
  total_medicare: string
  total_savings: string
  status_counts: Record<string, number>
  // law_firm only
  bills_awaiting_funder?: number
  // funder / admin only
  pending_review?: number
}

interface SummaryResponse {
  success: boolean
  data: DashboardSummary
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [summary, setSummary] = useState<DashboardSummary | null>(null)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    setUser(getUser())
    api.get<SummaryResponse>('/api/dashboard/summary')
      .then((res) => setSummary(res.data))
      .catch(console.error)
  }, [router])

  if (!user) return null

  const isFunder = user.role === 'funder' || user.role === 'admin'

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="mt-1 text-sm text-gray-500">
              Welcome back, {user.organization_name || user.email}
            </p>
          </div>

          {/* Funding queue alert — funder */}
          {isFunder && summary && summary.pending_review !== undefined && (
            <div className={`mb-6 rounded-xl border p-5 flex items-center justify-between ${
              summary.pending_review > 0
                ? 'bg-amber-50 border-amber-200'
                : 'bg-gray-50 border-gray-200'
            }`}>
              <div>
                <p className={`text-sm font-semibold ${summary.pending_review > 0 ? 'text-amber-800' : 'text-gray-600'}`}>
                  {summary.pending_review > 0
                    ? `${summary.pending_review} bill${summary.pending_review !== 1 ? 's' : ''} awaiting your review`
                    : 'No bills pending review'}
                </p>
                {summary.pending_review > 0 && (
                  <p className="text-xs text-amber-600 mt-0.5">Review and fund or reject each bill</p>
                )}
              </div>
              {summary.pending_review > 0 && (
                <Link
                  href="/bills"
                  className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700 transition-colors whitespace-nowrap"
                >
                  Review Bills →
                </Link>
              )}
            </div>
          )}

          {/* Awaiting funder alert — law firm */}
          {user.role === 'law_firm' && summary && (summary.bills_awaiting_funder ?? 0) > 0 && (
            <div className="mb-6 rounded-xl border bg-blue-50 border-blue-200 p-5 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-800">
                  {summary.bills_awaiting_funder} bill{summary.bills_awaiting_funder !== 1 ? 's' : ''} sent to funder
                </p>
                <p className="text-xs text-blue-600 mt-0.5">Waiting for funder review</p>
              </div>
              <Link
                href="/bills"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
              >
                View Bills →
              </Link>
            </div>
          )}

          {/* Metric cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <MetricCard
              label={isFunder ? 'Cases in Review' : 'Total Cases'}
              value={summary ? String(summary.total_cases) : '—'}
            />
            <MetricCard
              label="Total Billed"
              value={summary ? formatCurrency(summary.total_billed) : '—'}
            />
            <MetricCard
              label="Medicare Value"
              value={summary ? formatCurrency(summary.total_medicare) : '—'}
            />
            <MetricCard
              label="Total Savings"
              value={summary ? formatCurrency(summary.total_savings) : '—'}
            />
          </div>

          {/* Status breakdown */}
          {summary && Object.keys(summary.status_counts).length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Cases by Status</h2>
              <div className="flex gap-6 flex-wrap">
                {Object.entries(summary.status_counts).map(([status, count]) => (
                  <div key={status} className="flex items-center gap-2">
                    <span className="text-sm text-gray-500 capitalize">
                      {status.replace(/_/g, ' ')}:
                    </span>
                    <span className="text-sm font-semibold text-gray-900">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-4 justify-end">
            {user.role !== 'funder' && (
              <Link href="/cases" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
                View all cases →
              </Link>
            )}
            <Link href="/bills" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              {isFunder ? 'View funding queue →' : 'View all bills →'}
            </Link>
          </div>

        </div>
      </main>
    </>
  )
}
