// @ts-check

/**
 * T1 (spec 001) — Next.js App Router config for the Vercel/v0 dashboard shell.
 * P1 (Substrate): the Vercel app hosts only the dashboard + thin API routes; it
 * never runs diff analysis, Playwright, or ffmpeg (those live on the Actions runner).
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  // P5 (Safety rails): never expose server secrets to the client. We keep secrets
  // out of the bundle by reading them only in server modules (see app/lib/env.ts);
  // no secret is ever placed under `env`/`NEXT_PUBLIC_*` here.
  poweredByHeader: false,
};

export default nextConfig;
