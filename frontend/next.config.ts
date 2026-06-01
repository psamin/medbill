import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // standalone is only needed for the Docker production build (node server.js)
  // setting it in dev mode triggers file-tracing on first request and can hang
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,

  // handle / → /login at the routing layer so webpack never needs to compile
  // the root Server Component just to send a redirect
  async redirects() {
    return [
      { source: '/', destination: '/login', permanent: false },
    ]
  },
}

export default nextConfig
