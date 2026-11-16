const textEncoder = new TextEncoder();

/**
 * Computes a lowercase hex SHA-256 digest using Web Crypto `crypto.subtle.digest`.
 */
export async function sha256DigestHex(input: string): Promise<string> {
  const bytes = textEncoder.encode(input);
  const digestBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const digestBytes = new Uint8Array(digestBuffer);
  let hex = '';
  for (let i = 0; i < digestBytes.length; i++) {
    hex += digestBytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Constant-time byte-slice comparison using XOR accumulation across all bytes.
 */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  const maxLen = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < maxLen; i++) {
    const byteA = i < a.length ? a[i]! : 0;
    const byteB = i < b.length ? b[i]! : 0;
    diff |= byteA ^ byteB;
  }
  return diff === 0;
}

/**
 * Constant-time comparison of two UTF-8 / hex secret strings via byte XOR.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(textEncoder.encode(a), textEncoder.encode(b));
}
