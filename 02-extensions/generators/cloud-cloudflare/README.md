# cloud-cloudflare

Cloud Generator (kind `cloud`). Reads `ui_spec`; writes `wrangler.toml` (Workers static assets, `directory = "../../web"`) and a README with the deploy command.
Configuration only: no Worker code, no secrets, no timestamps. Needs `ui-web` in the same `.uapp`. Serving a real backend (`api-rest` routes) is a separate extension.

**Status: never deployed** (no Cloudflare account where it was written). Tests check the generated config and that `../../web` resolves inside a real `.uapp`.
