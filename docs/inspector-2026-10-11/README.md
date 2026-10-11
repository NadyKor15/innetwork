# MCP Inspector CLI, both protocol eras (2026-10-11)

Independent client: `@modelcontextprotocol/inspector@2.8.0`, server `node server/server.ts --port 8796` (directory: unit-test double, which does not change the protocol surface).

```
npx -y @modelcontextprotocol/inspector@2.8.0 --cli http://127.0.0.1:8796/mcp --transport http \
  --header 'Authorization: Bearer innet-sandbox-insp' --protocol-era legacy|modern \
  --method tools/list --strict            # -> tools-<era>.json: 9 tools, exit 0 (strict schema check)
  --method tools/list --app-info          # -> app-<era>.txt: 5 tools link a ui://innetwork/*.html MCP App view
  --method tools/call --tool-name consent --tool-arg action=show   # -> call-<era>.json
```
