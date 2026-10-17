import { processImage } from "./image";
import { qoiEncode } from "./qoi";
import { encodeAndCompress } from "./compress";

export interface Env {
  // Bindings or environment variables can be added here
}

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, X-Use-OpenCV"
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Handle CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // Health / Documentation route
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return new Response(
        JSON.stringify({
          name: "velover-image-extractor-worker",
          version: "1.0.0",
          description: "Cloudflare Worker port of Velover Template (Image -> QOI -> Base64 -> Deflate -> Base64)",
          usage: {
            method: "POST",
            path: "/convert",
            bodyTypes: [
              "multipart/form-data (field: 'image' or 'file')",
              "image/png, image/jpeg, application/octet-stream (raw binary body)",
              "application/json ({ imageBase64: '...' })"
            ]
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

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed. Use POST /convert" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    try {
      const contentType = request.headers.get("content-type") || "";
      const useOpenCV = request.headers.get("x-use-opencv") === "true" || url.searchParams.get("opencv") === "true";
      let imageBuffer: ArrayBuffer | null = null;
      let filename = "image";

      if (contentType.includes("multipart/form-data")) {
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
        const body = (await request.json()) as { imageBase64?: string; name?: string };
        if (!body.imageBase64) {
          return new Response(JSON.stringify({ error: "Missing 'imageBase64' field in JSON body" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders() }
          });
        }
        if (body.name) filename = body.name;

        // Clean base64 data uri prefix if present
        const cleanBase64 = body.imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const binaryStr = atob(cleanBase64);
        const len = binaryStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        imageBuffer = bytes.buffer;
      } else {
        // Raw binary body (image/png, image/jpeg, application/octet-stream)
        imageBuffer = await request.arrayBuffer();
        if (!imageBuffer || imageBuffer.byteLength === 0) {
          return new Response(JSON.stringify({ error: "Empty request body" }), {
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
