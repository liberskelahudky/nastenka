/**
 * LL Nástěnka — Cloudflare Worker (backend)
 * -----------------------------------------
 * Uchovává vzkazy v Cloudflare KV. Stránky (TV i admin) se na něj napojí,
 * takže nikdo nemusí nikam zadávat žádný token.
 *
 * NASTAVENÍ VE WORKERU:
 *   1) KV Namespace binding:  název  NASTENKA   (vytvoř KV namespace a přiřaď ho pod tímto názvem)
 *   2) (nepovinné) Variable:  WRITE_KEY = LL-nastenka-8Kq3Zx7m
 *      - když ji nastavíš, psát může jen ten, kdo zná klíč (admin ho má v sobě)
 *      - když ji nenastavíš, Worker přijme zápis od kohokoliv (jednodušší, ale bez ochrany)
 */

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    const KV = env.NASTENKA;
    const KEY = "messages";

    async function readAll() {
      if (!KV) return [];
      const raw = await KV.get(KEY);
      if (!raw) return [];
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    async function writeAll(list) {
      await KV.put(KEY, JSON.stringify(list));
    }

    try {
      if (request.method === "GET") {
        const list = await readAll();
        return new Response(JSON.stringify({ messages: list, updated: new Date().toISOString() }), { headers: cors });
      }

      if (request.method === "POST") {
        let body;
        try { body = JSON.parse(await request.text()); }
        catch (e) { return json({ error: "bad_json" }, 400, cors); }

        // volitelná ochrana zápisu
        if (env.WRITE_KEY && body.key !== env.WRITE_KEY) {
          return json({ error: "unauthorized" }, 401, cors);
        }

        let list = await readAll();
        const action = body.action;

        if (action === "add" || action === "update") {
          const m = body.msg;
          if (!m || !m.id) return json({ error: "no_msg" }, 400, cors);
          const i = list.findIndex(x => x.id === m.id);
          if (i >= 0) list[i] = m; else list.unshift(m);
        } else if (action === "delete") {
          list = list.filter(x => x.id !== body.id);
        } else {
          return json({ error: "bad_action" }, 400, cors);
        }

        await writeAll(list);
        return json({ ok: true, messages: list }, 200, cors);
      }

      return json({ error: "method_not_allowed" }, 405, cors);
    } catch (err) {
      return json({ error: String(err) }, 500, cors);
    }
  }
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status: status, headers: cors });
}
