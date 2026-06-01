interface StatusBadgeProps {
  status: string
}

const COLOR_MAP: Record<string, string> = {
  // Case statuses
  active:                'bg-green-100 text-green-800',
  bills_uploaded:        'bg-orange-100 text-orange-800',
  provider_review:       'bg-yellow-100 text-yellow-800',
  ready_for_funding:     'bg-blue-100 text-blue-800',
  ready_for_batching:    'bg-blue-100 text-blue-800',
  batch_created:         'bg-indigo-100 text-indigo-800',
  batch_submitted:       'bg-indigo-100 text-indigo-800',
  funder_review:         'bg-indigo-100 text-indigo-800',
  funded:                'bg-purple-100 text-purple-800',
  rejected:              'bg-red-100 text-red-800',
  closed:                'bg-gray-100 text-gray-800',
  reviewing_bills:       'bg-yellow-100 text-yellow-800',
  // Bill processing statuses
  uploaded:              'bg-gray-100 text-gray-700',
  processing:            'bg-yellow-100 text-yellow-800',
  completed:             'bg-green-100 text-green-800',
  failed:                'bg-red-100 text-red-800',
  review_ready:          'bg-amber-100 text-amber-800',
  // Funding statuses
  not_requested:         'bg-gray-100 text-gray-500',
  funding_requested:     'bg-blue-100 text-blue-800',
  under_review:          'bg-amber-100 text-amber-800',
  partially_funded:      'bg-purple-100 text-purple-800',
}

const LABEL_MAP: Record<string, string> = {
  // Case statuses
  active:                'Active',
  bills_uploaded:        'Bills Uploaded',
  provider_review:       'Provider Review',
  ready_for_funding:     'Ready for Funding',
  ready_for_batching:    'Ready for Batching',
  batch_created:         'Batch Created',
  batch_submitted:       'Batch Submitted',
  funder_review:         'Under Review',
  funded:                'Funded',
  rejected:              'Rejected',
  closed:                'Closed',
  reviewing_bills:       'Reviewing Bills',
  // Bill processing statuses
  uploaded:              'Uploaded',
  processing:            'Processing',
  completed:             'Processed',
  failed:                'Failed',
  review_ready:          'Ready for Batch',
  // Funding / batch item statuses
  not_requested:         'Not Batched',
  funding_requested:     'Batched',
  under_review:          'Under Review',
  partially_funded:      'Partially Funded',
  submitted:             'Submitted',
  draft:                 'Draft',
  pending:               'Pending',
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const colorClass = COLOR_MAP[status] ?? 'bg-gray-100 text-gray-800'
  const label = LABEL_MAP[status] ?? status.replace(/_/g, ' ')
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  )
}
