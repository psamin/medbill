import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatDate } from '@/lib/formatters'
import type { MedicalBill } from '@/types/billing'

interface BillTableProps {
  bills: MedicalBill[]
  userRole?: string
}

const EMPTY: Record<string, string> = {
  law_firm: 'No bills uploaded yet. Upload a bill from a case page.',
  provider: 'No bills on your assigned cases yet.',
  funder:   'No bills awaiting funding review on your assigned cases.',
  admin:    'No bills in the system.',
}

export default function BillTable({ bills, userRole }: BillTableProps) {
  if (bills.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-400">
          {EMPTY[userRole ?? ''] ?? 'No bills found.'}
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-4 py-3 font-medium text-gray-600">Provider</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">File</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Funding</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Total Billed</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Savings</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {bills.map((b) => (
            <tr key={b.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors">
              <td className="px-4 py-3 text-gray-900">{b.provider_name || '—'}</td>
              <td className="px-4 py-3">
                <Link
                  href={`/bills/${b.id}`}
                  className="text-blue-600 hover:text-blue-700 text-xs"
                >
                  {b.original_filename}
                </Link>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={b.status} />
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={b.funding_status} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(b.total_billed_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(b.total_savings)}
              </td>
              <td className="px-4 py-3 text-gray-500">{formatDate(b.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
