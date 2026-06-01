import StatusBadge from '@/components/StatusBadge'
import { formatCurrency, formatRatio, formatPercentage } from '@/lib/formatters'
import type { BillLineItem } from '@/types/billing'

interface LineItemTableProps {
  items: BillLineItem[]
}

export default function LineItemTable({ items }: LineItemTableProps) {
  if (items.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
        <p className="text-sm text-gray-400">
          No line items extracted yet. PDF processing comes in Step 8.
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="text-left px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">#</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Code</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Description</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Qty</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Billed</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Medicare</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600 hidden sm:table-cell">Savings</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600 hidden md:table-cell">Ratio</th>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Match</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr
              key={item.id}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50 transition-colors"
            >
              <td className="px-4 py-3 text-gray-400 tabular-nums hidden sm:table-cell">{item.line_number ?? '—'}</td>
              <td className="px-4 py-3">
                {item.code ? (
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                    {item.code}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-700 max-w-[120px] sm:max-w-xs truncate">
                {item.description || '—'}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 hidden sm:table-cell">
                {item.quantity}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(item.billed_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-900">
                {formatCurrency(item.medicare_allowed_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-green-700 hidden sm:table-cell">
                {formatCurrency(item.savings_amount)}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-gray-600 hidden md:table-cell">
                {formatRatio(item.billing_ratio)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.match_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}
