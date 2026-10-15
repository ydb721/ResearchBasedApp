import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

class MemoryBucket {
  objects = new Map();
  async head(key) { return this.objects.get(key) ?? null; }
  async put(key, body, options) {
    assert.ok(body instanceof Uint8Array, "R2 receives a bounded byte array");
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    this.objects.set(key, { key, bytes, size: bytes.length, customMetadata: options.customMetadata });
  }
  async get(key) {
    const item = this.objects.get(key);
    return item ? { ...item, body: new Response(item.bytes).body } : null;
  }
  async delete(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key); }
  async list({ prefix }) { return { objects: [...this.objects.values()].filter(x => x.key.startsWith(prefix)) }; }
}

const source = await readFile(new URL("../dist/server/index.js", import.meta.url), "utf8");
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const worker = (await import(moduleUrl)).default;
const bucket = new MemoryBucket();
const env = { BUCKET: bucket };
const payload = new Uint8Array(64).fill(7);
payload.set([77, 86, 75, 84, 51, 0, 13, 10], 0);
const send = await worker.fetch(new Request("https://movekit.example/api/transfers", {
  method: "POST", headers: { "content-type": "application/octet-stream" }, body: payload,
}), env);
assert.equal(send.status, 201);
const { code, expiresAt } = await send.json();
assert.match(code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{12}$/);
assert.ok(Date.parse(expiresAt) > Date.now());
const receive = await worker.fetch(new Request(`https://movekit.example/api/transfers/${code}`), env);
assert.equal(receive.status, 200);
assert.deepEqual(new Uint8Array(await receive.arrayBuffer()), payload);
assert.equal((await worker.fetch(new Request("https://movekit.example/api/transfers/NOT-A-CODE"), env)).status, 404);
const stored = bucket.objects.get(`temporary/${code}`);
stored.customMetadata.expiresAt = String(Date.now() - 1);
const expired = await worker.fetch(new Request(`https://movekit.example/api/transfers/${code}`), env);
assert.equal(expired.status, 410);
assert.equal(bucket.objects.has(`temporary/${code}`), false);
const tooLarge = await worker.fetch(new Request("https://movekit.example/api/transfers", {
  method: "POST", headers: { "content-type": "application/octet-stream", "content-length": String(91 * 1024 * 1024) }, body: payload,
}), env);
assert.equal(tooLarge.status, 413);
const storageDown = await worker.fetch(new Request("https://movekit.example/api/transfers", {
  method: "POST", headers: { "content-type": "application/octet-stream" }, body: payload,
}), {});
assert.equal(storageDown.status, 503);
const invalidFormat = await worker.fetch(new Request("https://movekit.example/api/transfers", {
  method: "POST", headers: { "content-type": "application/octet-stream" }, body: new Uint8Array(64).fill(0),
}), env);
assert.equal(invalidFormat.status, 400);
console.log("Worker API checks passed: encrypted envelope upload, retrieve, invalid code, expiry deletion, size cap, invalid format, missing storage binding.");
