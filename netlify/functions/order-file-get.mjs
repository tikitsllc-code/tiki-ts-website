// Sends one order file (artwork or mockup) to the admin Orders page.
// Only the logged-in shop owner can download files.
import { getStore } from "@netlify/blobs";

const REPO = "tikitsllc-code/tiki-ts-website";

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
  const key = new URL(req.url).searchParams.get("key") || "";
  if (!/^\d{14}-[a-z0-9]{6}\/\d+-[\w.\- ]+$/.test(key)) return new Response("Bad file", { status: 400 });
  const found = await getStore("order-files").getWithMetadata(key, { type: "arrayBuffer" });
  if (!found) return new Response("File not found", { status: 404 });
  const meta = found.metadata || {};
  return new Response(found.data, {
    headers: {
      "Content-Type": meta.type || "application/octet-stream",
      "Cache-Control": "private, no-store"
    }
  });
};
