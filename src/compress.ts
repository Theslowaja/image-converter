/**
 * Encodes a Uint8Array to a Base64 string safely without call stack overflow.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    chunks.push(String.fromCharCode.apply(null, Array.from(chunk)));
  }
  return btoa(chunks.join(""));
}

/**
 * Compresses data using raw DEFLATE (RFC 1951).
 * Uses native Web Streams CompressionStream('deflate-raw') supported natively in Cloudflare Workers.
 */
export async function rawDeflate(data: Uint8Array): Promise<Uint8Array> {
  if (typeof CompressionStream !== "undefined") {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    writer.write(data as any);
    writer.close();
    const arrayBuffer = await new Response(cs.readable).arrayBuffer();
    return new Uint8Array(arrayBuffer);
  }

  // Fallback for older environments via dynamic import pako
  try {
    const pako = await import("pako");
    return pako.default.deflateRaw(data, { level: 5, strategy: 2 });
  } catch {
    throw new Error("No raw DEFLATE compression engine available.");
  }
}

/**
 * Pipeline matching Velover Template (ExtactImageData + main.lua):
 * 1. QOI binary data -> Base64 string
 * 2. Base64 string -> raw DEFLATE compression
 * 3. Compressed binary data -> Base64 string
 */
export async function encodeAndCompress(qoiBytes: Uint8Array): Promise<string> {
  // Step 1: Base64 of QOI bytes
  const firstBase64 = bytesToBase64(qoiBytes);

  // Step 2: Convert first Base64 string into UTF-8 bytes, then raw Deflate
  const encoder = new TextEncoder();
  const rawBase64Bytes = encoder.encode(firstBase64);
  const compressedBytes = await rawDeflate(rawBase64Bytes);

  // Step 3: Base64 of the compressed bytes
  return bytesToBase64(compressedBytes);
}
