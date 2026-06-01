import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'MedBill',
  description: 'Medical Bill Processing Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
