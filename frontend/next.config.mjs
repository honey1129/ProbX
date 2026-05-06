/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      crypto: false,
      fs: false,
      os: false,
      path: false,
      net: false,
      stream: false,
      tls: false
    };
    return config;
  }
};

export default nextConfig;
