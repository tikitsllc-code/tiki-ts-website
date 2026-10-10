// The admin Orders page talks to this. Only someone logged in to the admin with GitHub
// (and allowed to edit the website's repository) can see, update or delete orders.
import { getStore } from "@netlify/blobs";

const REPO = "tikitsllc-code/tiki-ts-website";
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
  if (!(await isShopOwner(req))) return new Response("Please log in to the admin first", { status: 401 });
  const orders = getStore({ name: "orders", consistency: "strong" });

  if (req.method === "GET") {
    const { blobs } = await orders.list();
    const all = (await Promise.all(blobs.map((b) => orders.get(b.key, { type: "json" })))).filter(Boolean);
    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return Response.json(all);
  }

  if (req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }
    const id = String(body.id || "");
    if (!ID_PATTERN.test(id)) return new Response("Bad order id", { status: 400 });
    const order = await orders.get(id, { type: "json" });
    if (!order) return new Response("Order not found", { status: 404 });

    if (body.action === "delete") {
      const files = getStore({ name: "order-files", consistency: "strong" });
      await Promise.all((order.uploads || []).map((u) => files.delete(u.key)));
      await orders.delete(id);
      return Response.json({ ok: true });
    }
    if (body.action === "status" && ["new", "done"].includes(body.status)) {
      order.status = body.status;
      await orders.setJSON(id, order);
      return Response.json(order);
    }
    return new Response("Unknown action", { status: 400 });
  }

  return new Response("Method not allowed", { status: 405 });
};
