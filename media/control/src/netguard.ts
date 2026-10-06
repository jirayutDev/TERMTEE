/**
 * inputUrl validation for pull inputs (HLS, DASH, RTSP, BROWSER): scheme per input type, plus an SSRF
 * guard that rejects hosts resolving to private / loopback / link-local / reserved addresses, so a start
 * request cannot make ffmpeg or Chromium reach the internal network or a cloud metadata endpoint.
 * ALLOW_PRIVATE_INPUT_HOSTS=true turns the address check off (local testing only).
 *
 * Limits: the check runs once, at start, on the URL itself. Redirects, HLS/DASH segment URLs and the
 * sub-resources a captured page loads are not re-checked (see README, "Security").
 * Shared by control and capture, so it reads process.env directly instead of importing config.ts.
 */
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { InputType } from "./contract.js";

const SCHEMES: Partial<Record<InputType, string[]>> = {
  HLS: ["http:", "https:"],
  DASH: ["http:", "https:"],
  RTSP: ["rtsp:", "rtsps:"],
  BROWSER: ["http:", "https:"],
};

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this" network
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8],
  ["169.254.0.0", 16], // link-local, cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // includes Docker's default bridge networks
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
  ["2001:db8::", 32], // documentation
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function allowPrivateInputHosts(): boolean {
  return process.env.ALLOW_PRIVATE_INPUT_HOSTS === "true";
}

/** True when the address is not publicly routable. */
export function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1]; // IPv4-mapped IPv6
    if (mapped) return blocked.check(mapped, "ipv4");
    return blocked.check(address, "ipv6");
  }
  return true; // not an IP: treat as unsafe
}

/**
 * Validate inputUrl for a pull input type. Returns the normalized URL; throws an Error whose message
 * is safe to return to the caller (400).
 */
export async function checkInputUrl(inputType: InputType, raw: string | undefined): Promise<string> {
  const schemes = SCHEMES[inputType];
  if (!schemes) throw new Error(`${inputType} does not take an inputUrl`);
  const want = schemes.map((s) => s.slice(0, -1)).join("/");
  if (!raw || raw.length > 2048) throw new Error(`inputUrl (${want}) required for ${inputType}`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("inputUrl is not a valid URL");
  }
  if (!schemes.includes(url.protocol)) throw new Error(`inputUrl must be ${want} for ${inputType}`);
  if (!url.hostname) throw new Error("inputUrl has no host");
  if (allowPrivateInputHosts()) return url.href;

  const host = url.hostname.replace(/^\[(.*)\]$/, "$1"); // IPv6 literal
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = (await lookup(host, { all: true, verbatim: true })).map((a) => a.address);
    } catch {
      throw new Error(`inputUrl host ${host} does not resolve`);
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new Error(`inputUrl host ${host} is a private, loopback or link-local address (not allowed)`);
  }
  return url.href;
}
