// Receives one file for an order: the customer's artwork or a shirt mockup picture.
// Files can only be added to an order in the first hour after it was created.
import { getStore } from "@netlify/blobs";

const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_FILES_PER_ORDER = 12;
const ID_PATTERN = /^\d{14}-[a-z0-9]{6}$/;

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind") === "mockup" ? "mockup" : "art";
  const name = (url.searchParams.get("name") || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "file";
  if (!ID_PATTERN.test(id)) return new Response("Bad order id", { status: 400 });

  const orders = getStore("orders");
  const order = await orders.get(id, { type: "json" });
  if (!order) return new Response("Order not found", { status: 404 });
  if (Date.now() - new Date(order.createdAt).getTime() > 60 * 60 * 1000) {
    return new Response("This order can't take new files anymore", { status: 403 });
  }
  if ((order.uploads || []).length >= MAX_FILES_PER_ORDER) return new Response("Too many files", { status: 400 });

  const body = await req.arrayBuffer();
  if (!body.byteLength) return new Response("Empty file", { status: 400 });
  if (body.byteLength > MAX_FILE_BYTES) return new Response("File is too large", { status: 413 });

  const type = (req.headers.get("content-type") || "application/octet-stream").slice(0, 100);
  const key = id + "/" + ((order.uploads || []).length + 1) + "-" + name;
  await getStore("order-files").set(key, body, { metadata: { name, kind, type } });

  order.uploads = [...(order.uploads || []), { key, name, kind, type, size: body.byteLength }];
  await orders.setJSON(id, order);
  return Response.json({ ok: true, key });
};
