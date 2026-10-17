/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Серверные Node-библиотеки не бандлим в сборку (у них нативные/опциональные зависимости).
  serverExternalPackages: ["bullmq", "ioredis", "@prisma/client", "googleapis"],
  // Заголовки безопасности по умолчанию для всех страниц.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
