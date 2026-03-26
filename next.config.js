/** @type {import('next').NextConfig} */
const nextConfig = {
  // Tell Vercel's output file tracing to bundle the SQLite DB
  outputFileTracingIncludes: {
    '/api/chat': ['./data/o2c.db'],
    '/api/graph': ['./data/o2c.db'],
    '/api/kpis': ['./data/o2c.db'],
    '/api/chain': ['./data/o2c.db'],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push('better-sqlite3');
    }
    return config;
  },
};

module.exports = nextConfig;
