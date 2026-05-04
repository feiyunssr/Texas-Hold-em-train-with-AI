import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["192.168.1.242"],
  reactStrictMode: true,
  serverExternalPackages: ["poker-evaluator"]
};

export default nextConfig;
