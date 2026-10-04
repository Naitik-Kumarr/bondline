import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The shared workspace package ships TypeScript source (with `.ts` import specifiers), so Next compiles it.
  transpilePackages: ["@bondline/shared"],
  // Lets two dev servers run side by side (NEXT_DIST_DIR=.next-a, .next-b) without sharing a build folder.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  // Baseline browser protections on every route (audit finding W3): no framing, no MIME sniffing, a conservative
  // referrer, and no camera, microphone, location or payment APIs. No Content-Security-Policy yet: a strict one has to
  // be tested against the wallet connectors and RPC calls first.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        ],
      },
    ];
  },
  // Files the server reads from outside web/ at run time (verification verdicts, proof and backtest reports, the
  // Stylus pricer and ProofOfCover records, claim letters, the party plan): Next's file tracing can't see the paths
  // (they are built at run time), so name them. Missing files are fine: every reader treats absence as "not yet".
  outputFileTracingIncludes: {
    "/*": [
      "../verification/*.json",
      "../contracts/reports/**/*",
      "../docs/data/*.json",
      "../deployments/party.json",
      "../deployments/gap-party.json",
      "../deployments/stylus-pricer.json",
      "../stylus/offchain-prices.json",
      "../deployments/proof-of-cover.json",
      "../deployments/letters/*.json",
    ],
  },
  experimental: {
    optimizePackageImports: ["motion", "@number-flow/react"],
  },
  // `npm run dev` uses Turbopack, which ignores the webpack config below: give it the same aliases.
  turbopack: {
    resolveAlias: {
      "@base-org/account": "./src/lib/empty-module.ts",
      "@react-native-async-storage/async-storage": "./src/lib/empty-module.ts",
      "pino-pretty": "./src/lib/empty-module.ts",
    },
  },
  webpack: (config) => {
    // Optional peer deps pulled in by WalletConnect's logger and storage; not needed in the browser.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    // wagmi/connectors lazily imports the Base Account SDK, whose Node build pulls in Coinbase's CDP SDK and
    // uninstalled x402 packages. Bondline never offers that connector, so resolve it to an empty module.
    // MetaMask's SDK (also lazy) optionally imports React Native storage, which a browser build never needs.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@base-org/account": false,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
};

export default nextConfig;
