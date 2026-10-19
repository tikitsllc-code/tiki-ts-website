// Receives one file for an order: the customer's artwork or a shirt mockup picture.
// Customers can only add files in the first hour after the order was created.
// The logged-in shop owner (from the Orders page) can add files to an order any time.
import { getStore } from "@netlify/blobs";

const REPO = "tikitsllc-code/tiki-ts-website";
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const MAX_FILES_PER_ORDER = 12;
const MAX_FILES_SHOP = 60;
const ID_PATTERN = /^\d{14}-[a-z0-9]{6}$/;

async function isShopOwner(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const res = await fetch("https://api.github.com/repos/" + REPO, {
    headers: { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "tiki-ts-orders" }
  });
  if (!res.ok) return false;
  const repo = await res.json();
  return !!(repo.permissions && (repo.permissions.push || repo.permissions.admin));
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const kind = url.searchParams.get("kind") === "mockup" ? "mockup" : "art";
  const name = (url.searchParams.get("name") || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 100) || "file";
  if (!ID_PATTERN.test(id)) return new Response("Bad order id", { status: 400 });

  // A login means it's the shop editing the order; a wrong login is refused, not treated as a customer
  const shop = req.headers.get("authorization") ? await isShopOwner(req) : false;
  if (req.headers.get("authorization") && !shop) return new Response("Please log in to the admin first", { status: 401 });

  const orders = getStore({ name: "orders", consistency: "strong" });
  const order = await orders.get(id, { type: "json" });
  if (!order) return new Response("Order not found", { status: 404 });
  if (!shop && Date.now() - new Date(order.createdAt).getTime() > 60 * 60 * 1000) {
    return new Response("This order can't take new files anymore", { status: 403 });
  }
  if ((order.uploads || []).length >= (shop ? MAX_FILES_SHOP : MAX_FILES_PER_ORDER)) return new Response("Too many files", { status: 400 });

  const body = await req.arrayBuffer();
  if (!body.byteLength) return new Response("Empty file", { status: 400 });
  if (body.byteLength > MAX_FILE_BYTES) return new Response("File is too large", { status: 413 });

  const type = (req.headers.get("content-type") || "application/octet-stream").slice(0, 100);
  const key = id + "/" + ((order.uploads || []).length + 1) + "-" + name;
  await getStore({ name: "order-files", consistency: "strong" }).set(key, body, { metadata: { name, kind, type } });

  const upload = { key, name, kind, type, size: body.byteLength };
  if (shop) upload.byShop = true;
  order.uploads = [...(order.uploads || []), upload];
  await orders.setJSON(id, order);
  return Response.json({ ok: true, key, upload });
};
