# weclapp-mcp-server

A small remote MCP server that lets Claude read (and, if you extend it,
write) data in your weclapp tenant. Your weclapp API token stays on
this server — Claude only ever talks to *this* server, never to
weclapp directly.

Tools included out of the box:
- `list_customers`, `get_customer`
- `list_invoices`, `get_invoice`
- `list_articles`
- `weclapp_generic_get` — fallback for any other GET endpoint

## 1. Configure

```bash
cp .env.example .env
```

Edit `.env`:
- `WECLAPP_BASE_URL` — for your tenant this is
  `https://ecog.weclapp.com/webapp/api/v1`
- `WECLAPP_API_TOKEN` — the API key you generated in
  weclapp under Settings → API
- `MCP_SHARED_SECRET` — make up a long random string yourself
  (e.g. run `openssl rand -hex 32`). This stops strangers from calling
  your server. You'll paste this same value into Claude later.

## 2. Run it locally first (sanity check)

```bash
npm install
npm start
```

You should see:
```
weclapp-mcp-server listening on port 3000
MCP endpoint: http://localhost:3000/mcp
```

If you have `curl`, you can smoke-test it:
```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer YOUR_MCP_SHARED_SECRET" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
You should get back JSON listing the tools above.

## 3. Deploy it somewhere reachable over HTTPS

Claude needs to reach this server over the public internet with HTTPS.
Local `localhost` won't work for the real connector. Easiest options,
roughly cheapest/simplest first:

- **Railway / Render / Fly.io** — connect your GitHub repo (or drag-and-drop
  this folder), set the three env vars in their dashboard, deploy. They
  give you an HTTPS URL automatically.
- **A VPS you already have** — run with `npm start` behind a reverse proxy
  (e.g. Caddy or nginx) that terminates HTTPS, or use a tool like
  `cloudflared tunnel` to get HTTPS without configuring certificates
  yourself.

Whichever you choose, set the same three environment variables
(`WECLAPP_BASE_URL`, `WECLAPP_API_TOKEN`, `MCP_SHARED_SECRET`) in that
platform's settings — don't commit your `.env` file anywhere public.

You'll end up with something like:
```
https://your-app-name.up.railway.app/mcp
```

## 4. Connect it in Claude

1. Go to Claude **Settings → Connectors**.
2. Choose **Add custom connector**.
3. Paste your server's URL, e.g. `https://your-app-name.up.railway.app/mcp`.
4. When it asks for auth, choose the option for a custom header /
   bearer token, and enter your `MCP_SHARED_SECRET` value.
5. Save, then enable the connector for a chat.

Claude will now see `list_customers`, `get_invoice`, etc. as tools it
can call when relevant, e.g. "look up invoice 1234 in weclapp."

## 5. Extend it

To add more tools (sales orders, quotations, contacts, etc.), copy the
pattern of `list_customers` in `server.js` — most weclapp list
endpoints follow the same shape: `/{resource}` with `page`,
`pageSize`, and `<field>-eq` / `<field>-like` query filters. weclapp's
full API reference is at `https://{your-tenant}.weclapp.com/webapp/api/help`
(auth required, browse it while logged in).

## Security notes

- Never put `WECLAPP_API_TOKEN` or `MCP_SHARED_SECRET` in code you
  commit to a public repo. Use your hosting platform's environment
  variable settings.
- This server currently allows any GET via `weclapp_generic_get`,
  which is convenient for exploring but also means Claude could read
  any data your API token can read. Remove that tool if you want to
  restrict access to only the specific tools above.
- If you add tools that create/update/delete data (POST/PUT/DELETE),
  treat those as higher-risk: consider requiring explicit confirmation
  in your prompts, or splitting a separate "read-only" token from a
  "write" token if weclapp's permission model supports it.
