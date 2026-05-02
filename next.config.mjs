/** @type {import('next').NextConfig} */
const nextConfig = {
  // In Next.js 14, server-external packages live under experimental
  experimental: {
    serverComponentsExternalPackages: [
      '@remotion/renderer',
      '@remotion/bundler',
      'remotion',
      'esbuild',
      '@esbuild/darwin-arm64',
      '@esbuild/darwin-x64',
      '@esbuild/linux-x64',
      'puppeteer-core',
    ],
  },
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        child_process: false,
        net: false,
        tls: false,
        crypto: false,
      };
    }
    return config;
  },
};

export default nextConfig;
