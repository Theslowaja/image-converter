import { processImage } from "./image";
import { qoiEncode } from "./qoi";
import { encodeAndCompress } from "./compress";

export interface Env {
  // Bindings or environment variables
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-Use-OpenCV"
  };
}

async function fetchImageFromUrl(imageUrl: string): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const parsed = new URL(imageUrl);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Invalid image URL protocol. Only http and https allowed.");
  }
  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) VeloverImageWorker/1.0"
    }
  });
  if (!res.ok) {
    throw new Error(`Failed to download image from URL (${res.status} ${res.statusText})`);
  }
  const buffer = await res.arrayBuffer();
  const pathParts = parsed.pathname.split("/");
  const filename = pathParts[pathParts.length - 1] || "image";
  return { buffer, filename };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Health / info
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health") && !url.searchParams.has("url")) {
      return new Response(
        JSON.stringify({
          name: "velover-image-extractor-worker",
          version: "1.1.0",
          description: "Cloudflare Worker port of Velover Template (Image -> QOI -> Base64 -> Deflate -> Base64)",
          usage: {
            viaUrlGet: "GET /convert?url=https://example.com/image.png",
            viaUrlPost: "POST /convert with JSON { url: 'https://example.com/image.png' }",
            viaFileUpload: "POST /convert with multipart/form-data (field: 'image' or 'file')",
            viaRawBinary: "POST /convert with image/png or image/jpeg binary body",
            viaBase64: "POST /convert with JSON { imageBase64: '...' }"
          }
        }, null, 2),
        {
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
          }
        }
      );
    }

    // Support both GET (with ?url=...) and POST
    if (request.method !== "POST" && request.method !== "GET") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use GET with ?url= or POST /convert" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    try {
      const contentType = request.headers.get("content-type") || "";
      const useOpenCV = request.headers.get("x-use-opencv") === "true" || url.searchParams.get("opencv") === "true";
      let imageBuffer: ArrayBuffer | null = null;
      let filename = "image";

      const queryUrl = url.searchParams.get("url");

      if (queryUrl) {
        // Source 1: GET /convert?url=https://...
        const downloaded = await fetchImageFromUrl(queryUrl);
        imageBuffer = downloaded.buffer;
        filename = downloaded.filename;
      } else if (contentType.includes("multipart/form-data")) {
        // Source 2: Multipart form upload
        const formData = await request.formData();
        const file = formData.get("image") || formData.get("file");
        if (!file || typeof file === "string") {
          return new Response(JSON.stringify({ error: "Missing 'image' or 'file' in multipart form data" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          });
        }
        filename = (file as File).name || "image";
        imageBuffer = await (file as File).arrayBuffer();
      } else if (contentType.includes("application/json")) {
        // Source 3: JSON body (url or base64)
        const body = (await request.json()) as { url?: string; imageBase64?: string; name?: string };
        if (body.url) {
          const downloaded = await fetchImageFromUrl(body.url);
          imageBuffer = downloaded.buffer;
          filename = body.name || downloaded.filename;
        } else if (body.imageBase64) {
          if (body.name) filename = body.name;
          const cleanBase64 = body.imageBase64.replace(/^data:image\/\w+;base64,/, "");
          const binaryStr = atob(cleanBase64);
          const len = binaryStr.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
          }
          imageBuffer = bytes.buffer;
        } else {
          return new Response(JSON.stringify({ error: "JSON body must contain 'url' or 'imageBase64'" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          });
        }
      } else {
        // Source 4: Raw binary body
        imageBuffer = await request.arrayBuffer();
        if (!imageBuffer || imageBuffer.byteLength === 0) {
          return new Response(JSON.stringify({ error: "Empty request body or missing ?url= parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          });
        }
      }

      // Step 1: Decode & Normalize image (max 1024x1024, Bilinear resize matching OpenCV cv::resize)
      const decoded = await processImage(imageBuffer, useOpenCV);

      // Step 2: Encode to QOI using exact Velover Template QOI specification
      const qoiBytes = qoiEncode(decoded.data, decoded.width, decoded.height, decoded.channels);

      // Step 3: Base64 -> Raw DEFLATE (level 5, fixed strategy) -> Base64
      const resultData = await encodeAndCompress(qoiBytes);

      // Return response
      const accept = request.headers.get("accept") || "";
      if (accept.includes("text/plain")) {
        return new Response(resultData, {
          status: 200,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            ...corsHeaders()
          }
        });
      }

      return new Response(
        JSON.stringify({
          success: true,
          name: filename,
          width: decoded.width,
          height: decoded.height,
          channels: decoded.channels,
          data: resultData,
          size: resultData.length
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
          }
        }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({
          success: false,
          error: err.message || "Failed to process image"
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders()
          }
        }
      );
    }
  }
};
