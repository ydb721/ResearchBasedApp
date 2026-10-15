const page = __PAGE_HTML__;
const PREFIX = "temporary/";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 12;
const TTL_MS = 30 * 60 * 1000;
const MAX_BYTES = 21 * 1024 * 1024;
const MIN_BYTES = 52;
const ENVELOPE_MAGIC = new Uint8Array([77, 86, 75, 84, 51, 0, 13, 10]);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

function randomCode() {
  let code = "";
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    for (const byte of bytes) {
      // 248 is the largest multiple of the 31-character alphabet below 256.
      if (byte < 248) code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === CODE_LENGTH) break;
    }
  }
  return code;
}

async function cleanExpired(bucket, now) {
  try {
    const page = await bucket.list({ prefix: PREFIX, limit: 100, include: ["customMetadata"] });
    const expired = page.objects
      .filter((object) => {
        const timestamp = Number(object.customMetadata?.expiresAt);
        return Number.isFinite(timestamp) && timestamp <= now;
      })
      .map((object) => object.key);
    if (expired.length) await bucket.delete(expired);
  } catch {
    // Expired codes remain inaccessible; storage cleanup can be retried on a later upload.
  }
}

async function createTransfer(request, env) {
  if (!env.BUCKET) return json({ error: "storage-unavailable" }, 503);
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength < MIN_BYTES)) return json({ error: "invalid-size" }, 400);
  if (contentLength !== null && contentLength > MAX_BYTES) return json({ error: "too-large" }, 413);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/octet-stream") {
    return json({ error: "invalid-type" }, 415);
  }
  if (!request.body) return json({ error: "empty-body" }, 400);

  const now = Date.now();
  await cleanExpired(env.BUCKET, now);
  let code;
  let key;
  for (let tries = 0; tries < 4; tries += 1) {
    code = randomCode();
    key = `${PREFIX}${code}`;
    if (!(await env.BUCKET.head(key))) break;
    code = undefined;
  }
  if (!code) return json({ error: "code-generation-failed" }, 503);
  const expiresAt = now + TTL_MS;
  let streamedBytes = 0;
  const magic = new Uint8Array(ENVELOPE_MAGIC.length);
  let magicBytes = 0;
  const boundedBody = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      streamedBytes += chunk.byteLength;
      if (streamedBytes > MAX_BYTES) return controller.error(new Error("too-large"));
      if (magicBytes < magic.length) {
        const take = Math.min(magic.length - magicBytes, chunk.byteLength);
        magic.set(chunk.subarray(0, take), magicBytes);
        magicBytes += take;
        if (magicBytes === magic.length && !ENVELOPE_MAGIC.every((byte, index) => magic[index] === byte)) {
          return controller.error(new Error("invalid-format"));
        }
      }
      controller.enqueue(chunk);
    },
    flush(controller) {
      if (streamedBytes < MIN_BYTES) controller.error(new Error("invalid-size"));
      if (magicBytes < magic.length) controller.error(new Error("invalid-format"));
    },
  }));
  try {
    await env.BUCKET.put(key, boundedBody, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: { expiresAt: String(expiresAt) },
    });
  } catch (error) {
    if (error?.message === "too-large") return json({ error: "too-large" }, 413);
    if (error?.message === "invalid-size" || error?.message === "invalid-format") return json({ error: error.message }, 400);
    return json({ error: "storage-write-failed" }, 503);
  }
  return json({ code, expiresAt: new Date(expiresAt).toISOString() }, 201);
}

async function readTransfer(code, env) {
  if (!env.BUCKET) return json({ error: "storage-unavailable" }, 503);
  if (!new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`).test(code)) return json({ error: "not-found" }, 404);
  const key = `${PREFIX}${code}`;
  let object;
  try {
    object = await env.BUCKET.get(key);
  } catch {
    return json({ error: "storage-read-failed" }, 503);
  }
  if (!object) return json({ error: "not-found" }, 404);
  const expiresAt = Number(object.customMetadata?.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    try { await env.BUCKET.delete(key); } catch {}
    return json({ error: "expired" }, 410);
  }
  return new Response(object.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(object.size),
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(page, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": "default-src 'self' blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        },
      });
    }
    if (request.method === "POST" && url.pathname === "/api/transfers") return createTransfer(request, env);
    const match = url.pathname.match(/^\/api\/transfers\/([^/]+)$/);
    if (request.method === "GET" && match) return readTransfer(match[1], env);
    return json({ error: "not-found" }, 404);
  },
};
