/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  outputFileTracingIncludes: { "/api/**": ["./seed/**"], "/**": ["./seed/**"] },
};
export default nextConfig;
