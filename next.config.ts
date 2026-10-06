import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Slip reading runs in Node route handlers. tesseract.js spawns worker_threads by
  // file path and loads WASM/traineddata at runtime, so it must not be bundled.
  // (sharp is already on Next's built-in external list; listed for clarity.)
  serverExternalPackages: ["tesseract.js", "sharp"],
};

export default nextConfig;
