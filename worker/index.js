/**
 * LL Nástěnka — Cloudflare Worker (backend) v2
 * --------------------------------------------
 * Vzkazy v KV (klíč "messages"). Obrázky zvlášť (klíč "img:<id>"), aby seznam
 * vzkazů zůstal malý a TV ho mohla často obnovovat.
 *
 * NASTAVENÍ VE WORKERU:
 *   1) KV Namespace binding:  název  NASTENKA
 *   2) (nepovinné) Variable:  WRITE_KEY = LL-nastenka-8Kq3Zx7m
 *
 * API:
 *   GET  /                → { messages: [...] }
 *   GET  /?img=<id>       → obrázek (image/jpeg) pro daný vzkaz
 *   POST /  {action:"add"|"update", msg:{...}, image?:"data:image/jpeg;base64,...", removeImage?:true, key}
 *   POST /  {action:"delete", id, key}
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    };
    const jsonHeaders = Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    const KV = env.NASTENKA;
    const KEY = "messages";
    const url = new URL(request.url);

    async function readAll() {
      if (!KV) return [];
      const raw = await KV.get(KEY);
      if (!raw) return [];
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    async function writeAll(list) { await KV.put(KEY, JSON.stringify(list)); }
    function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: jsonHeaders }); }

    try {
      // ---- obrázek ----
      if (request.method === "GET" && url.searchParams.get("img")) {
        const id = url.searchParams.get("img");
        const b64 = KV ? await KV.get("img:" + id) : null;
        if (!b64) return new Response("not found", { status: 404, headers: cors });
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=86400",
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      // ---- seznam vzkazů ----
      if (request.method === "GET") {
        const list = await readAll();
        return json({ messages: list, updated: new Date().toISOString() });
      }

      // ---- zápis ----
      if (request.method === "POST") {
        let body;
        try { body = JSON.parse(await request.text()); }
        catch (e) { return json({ error: "bad_json" }, 400); }

        if (env.WRITE_KEY && body.key !== env.WRITE_KEY) return json({ error: "unauthorized" }, 401);

        let list = await readAll();
        const action = body.action;

        if (action === "add" || action === "update") {
          const m = body.msg;
          if (!m || !m.id) return json({ error: "no_msg" }, 400);

          // obrázek
          if (body.removeImage) {
            await KV.delete("img:" + m.id);
            m.img = "";
          } else if (typeof body.image === "string" && body.image.indexOf("base64,") >= 0) {
            const b64 = body.image.split("base64,")[1];
            await KV.put("img:" + m.id, b64);
            m.img = m.id; // značka, že obrázek existuje
          }
          // pokud editace bez nového obrázku, m.img nechá klient tak, jak byl

          const i = list.findIndex(x => x.id === m.id);
          if (i >= 0) list[i] = m; else list.unshift(m);
        } else if (action === "delete") {
          await KV.delete("img:" + body.id);
          list = list.filter(x => x.id !== body.id);
        } else {
          return json({ error: "bad_action" }, 400);
        }

        await writeAll(list);
        return json({ ok: true, messages: list });
      }

      return json({ error: "method_not_allowed" }, 405);
    } catch (err) {
      return json({ error: String(err) }, 500);
    }
  }
};
