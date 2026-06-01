'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import AppShell from '@/components/AppShell'
import { isAuthenticated, getUser } from '@/lib/auth'
import { api } from '@/lib/api'
import { formatDate } from '@/lib/formatters'
import type { NegotiatedCptRate } from '@/types/billing'
import type { User } from '@/types/auth'

interface RateListResponse { success: boolean; data: NegotiatedCptRate[] }
interface RateResponse { success: boolean; data: NegotiatedCptRate }
interface ProviderUser { id: number; email: string; organization_name: string | null; role: string }
interface UsersResponse { success: boolean; data: ProviderUser[] }

const MULTIPLIER_HINT = 'e.g. 1.20 means provider receives 120% of Medicare allowed amount'

export default function NegotiatedCptRatesPage() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [rates, setRates] = useState<NegotiatedCptRate[]>([])
  const [providers, setProviders] = useState<ProviderUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filter state
  const [filterProvider, setFilterProvider] = useState<string>('')
  const [filterCode, setFilterCode] = useState<string>('')
  const [showInactive, setShowInactive] = useState(false)

  // Form state
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formProvider, setFormProvider] = useState<string>('')
  const [formCode, setFormCode] = useState<string>('')
  const [formMultiplier, setFormMultiplier] = useState<string>('1.00')
  const [formNotes, setFormNotes] = useState<string>('')
  const [formStartDate, setFormStartDate] = useState<string>('')
  const [formEndDate, setFormEndDate] = useState<string>('')
  const [formError, setFormError] = useState<string>('')
  const [formLoading, setFormLoading] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) { router.push('/login'); return }
    const u = getUser()
    setUser(u)
    if (u?.role !== 'law_firm' && u?.role !== 'admin') {
      router.push('/dashboard')
      return
    }
    Promise.all([
      api.get<RateListResponse>('/api/negotiated-cpt-rates?active_only=false'),
      api.get<UsersResponse>('/api/users?role=provider'),
    ])
      .then(([rateRes, userRes]) => {
        setRates(rateRes.data)
        setProviders(userRes.data)
      })
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [router])

  function openNew() {
    setEditingId(null)
    setFormProvider('')
    setFormCode('')
    setFormMultiplier('1.00')
    setFormNotes('')
    setFormStartDate('')
    setFormEndDate('')
    setFormError('')
    setShowForm(true)
  }

  function openEdit(rate: NegotiatedCptRate) {
    setEditingId(rate.id)
    setFormProvider(String(rate.provider_id))
    setFormCode(rate.cpt_code)
    setFormMultiplier(rate.medicare_anchor_multiplier)
    setFormNotes(rate.notes ?? '')
    setFormStartDate(rate.effective_start_date ?? '')
    setFormEndDate(rate.effective_end_date ?? '')
    setFormError('')
    setShowForm(true)
  }

  async function save() {
    if (!formProvider) { setFormError('Select a provider'); return }
    if (!formCode.trim()) { setFormError('Enter a CPT/HCPCS code'); return }
    const mult = parseFloat(formMultiplier)
    if (isNaN(mult) || mult <= 0) { setFormError('Multiplier must be a positive number'); return }

    setFormLoading(true); setFormError('')
    try {
      const body = {
        provider_id: parseInt(formProvider),
        cpt_code: formCode.trim().toUpperCase(),
        medicare_anchor_multiplier: formMultiplier,
        notes: formNotes || null,
        effective_start_date: formStartDate || null,
        effective_end_date: formEndDate || null,
      }
      let res: RateResponse
      if (editingId) {
        res = await api.patch<RateResponse>(`/api/negotiated-cpt-rates/${editingId}`, body)
        setRates(prev => prev.map(r => r.id === editingId ? res.data : r))
      } else {
        res = await api.post<RateResponse>('/api/negotiated-cpt-rates', body)
        setRates(prev => [res.data, ...prev])
      }
      setShowForm(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save')
    } finally { setFormLoading(false) }
  }

  async function deactivate(rate: NegotiatedCptRate) {
    try {
      await api.delete(`/api/negotiated-cpt-rates/${rate.id}`)
      setRates(prev => prev.map(r => r.id === rate.id ? { ...r, active: false } : r))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to deactivate')
    }
  }

  const displayed = rates.filter(r => {
    if (!showInactive && !r.active) return false
    if (filterProvider && String(r.provider_id) !== filterProvider) return false
    if (filterCode && !r.cpt_code.toLowerCase().includes(filterCode.toLowerCase())) return false
    return true
  })

  const providerName = (id: number) =>
    providers.find(p => p.id === id)?.organization_name ?? `Provider ${id}`

  return (
    <AppShell>
      <main className="p-4 sm:p-8">
        <div className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Negotiated CPT/HCPCS Rates</h1>
            <p className="mt-1 text-sm text-gray-500">
              Law firm + provider fee schedule by CPT code. Each code can have its own
              Medicare-based multiplier. Provider payout = Medicare Allowed × Multiplier.
            </p>
          </div>
          <button
            onClick={openNew}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shrink-0"
          >
            + Add CPT Rate
          </button>
        </div>

        {/* Add / Edit form */}
        {showForm && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 mb-6">
            <h2 className="text-sm font-semibold text-blue-900 mb-3">
              {editingId ? 'Edit CPT Rate' : 'Add CPT/HCPCS Negotiated Rate'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Provider *</label>
                <select
                  value={formProvider} onChange={e => setFormProvider(e.target.value)}
                  disabled={!!editingId}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100"
                >
                  <option value="">Select provider…</option>
                  {providers.map(p => (
                    <option key={p.id} value={String(p.id)}>
                      {p.organization_name || p.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">CPT/HCPCS Code *</label>
                <input
                  type="text" value={formCode} onChange={e => setFormCode(e.target.value.toUpperCase())}
                  placeholder="e.g. 99213"
                  disabled={!!editingId}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-gray-100 font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">
                  Medicare-Based Multiplier *
                  <span className="ml-1 text-gray-400 font-normal">({MULTIPLIER_HINT})</span>
                </label>
                <input
                  type="number" step="0.01" min="0.01" value={formMultiplier}
                  onChange={e => setFormMultiplier(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
                {formMultiplier && !isNaN(parseFloat(formMultiplier)) && (
                  <p className="text-xs text-green-700 mt-0.5">
                    Provider Negotiated Payout = Medicare Allowed × {parseFloat(formMultiplier).toFixed(2)}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Notes</label>
                <input
                  type="text" value={formNotes} onChange={e => setFormNotes(e.target.value)}
                  placeholder="Optional context"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Effective Start Date</label>
                <input
                  type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div>
                <label className="text-xs text-gray-600 mb-1 block">Effective End Date (leave blank if ongoing)</label>
                <input
                  type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
            {formError && <p className="text-xs text-red-600 mb-2">{formError}</p>}
            <div className="flex gap-2">
              <button onClick={save} disabled={formLoading}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {formLoading ? 'Saving…' : (editingId ? 'Update Rate' : 'Add Rate')}
              </button>
              <button onClick={() => setShowForm(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 mb-5 flex-wrap items-center">
          <select
            value={filterProvider} onChange={e => setFilterProvider(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none w-full sm:w-auto"
          >
            <option value="">All providers</option>
            {providers.map(p => (
              <option key={p.id} value={String(p.id)}>{p.organization_name || p.email}</option>
            ))}
          </select>
          <input
            type="text" value={filterCode} onChange={e => setFilterCode(e.target.value)}
            placeholder="Filter by CPT code…"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none w-full sm:w-40"
          />
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
          <span className="text-xs text-gray-400 ml-auto">{displayed.length} rate{displayed.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : displayed.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <p className="text-sm text-gray-400">No CPT rates yet.</p>
            <p className="text-xs text-gray-400 mt-1">
              Add rates to define negotiated multipliers per code for each law firm/provider pair.
            </p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[540px] text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Code</th>
                  <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500">Provider</th>
                  <th className="text-right px-4 sm:px-5 py-3 font-medium text-gray-500">Multiplier</th>
                  <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Notes</th>
                  <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden md:table-cell">Effective Dates</th>
                  <th className="text-left px-4 sm:px-5 py-3 font-medium text-gray-500 hidden sm:table-cell">Status</th>
                  <th className="px-4 sm:px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {displayed.map(rate => (
                  <tr key={rate.id} className={`border-b border-gray-100 last:border-0 ${rate.active ? 'hover:bg-gray-50' : 'opacity-50'}`}>
                    <td className="px-4 sm:px-5 py-3 font-mono font-semibold text-gray-900">{rate.cpt_code}</td>
                    <td className="px-4 sm:px-5 py-3 text-gray-700">{providerName(rate.provider_id)}</td>
                    <td className="px-4 sm:px-5 py-3 text-right tabular-nums">
                      <span className="text-blue-700 font-semibold">{(parseFloat(rate.medicare_anchor_multiplier) * 100).toFixed(0)}%</span>
                      <span className="text-gray-400 text-xs ml-1 hidden sm:inline">of Medicare</span>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-gray-500 text-xs hidden md:table-cell">{rate.notes ?? '—'}</td>
                    <td className="px-4 sm:px-5 py-3 text-xs text-gray-400 hidden md:table-cell">
                      {rate.effective_start_date ? formatDate(rate.effective_start_date) : '—'}
                      {rate.effective_end_date ? ` → ${formatDate(rate.effective_end_date)}` : ''}
                    </td>
                    <td className="px-4 sm:px-5 py-3 hidden sm:table-cell">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${rate.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {rate.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 sm:px-5 py-3 text-right">
                      {rate.active && (
                        <div className="flex items-center gap-3 justify-end">
                          <button onClick={() => openEdit(rate)}
                            className="text-xs text-blue-600 hover:text-blue-800 py-1">Edit</button>
                          <button onClick={() => deactivate(rate)}
                            className="text-xs text-gray-400 hover:text-red-600 py-1">Deactivate</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}
