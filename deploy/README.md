# Deploying Incognito

Two images, built on the VM, joined to the existing `hence-neo` compose stack so they share its
network and its Cloudflare tunnel.

```
incognito.hence.markets ──tunnel──▶ incognito-web (nginx)
                                      ├── /inc/*  ──▶ incognito-keeper:4400
                                      ├── /api/*  ──▶ app:4317        (Hence backend, prices/news)
                                      └── /*      ──▶ the Vite bundle
```

## Why it hangs off the neo-hence stack

The web app is a **fork of Hence**, so it inherits Hence's whole market layer — prices, charts,
news, the ticker tape. Without a reachable `/api` the terminal renders with no prices at all.
Sharing the compose network means nginx can reach `app:4317` by service name rather than routing
market data back out over the public internet.

## Why the workflow lives in the PRIVATE repo

`hence-incognito` is public. A self-hosted runner attached to a public repository will execute
code from any pull request, on the VM — so the deploy is dispatched from `neo-hence` (private),
which checks this repo out and builds it. Same reasoning as the Megapot deploy; do not "simplify"
it by adding a workflow here.

## Secrets

Exactly one matters: `OMNIBUS_KEY`, the keeper's signing key. It is a **runtime** env var on the
VM. Never a build arg — those are readable in image history forever — and never in this repo.

The `VITE_*` values are build args because Vite inlines them at build time. Setting them at
runtime does nothing, silently: the app falls back to defaults and the epoch panel drops to a
local clock while still looking alive. None of them are secret; a Privy app ID and a contract
address ship in the bundle regardless.

## First run on the VM

```bash
cd ~/neo-hence/deploy
# keeper secret — not in git, not in the image
echo 'OMNIBUS_KEY=0x…' >> .env
echo 'INCOGNITO_CONTRACT=0x431777cC5168cFe6D56B33D344E144699603FAe1' >> .env
docker compose up -d --build incognito-keeper incognito-web
docker compose restart cloudflared        # picks up the new ingress hostname
```

## Before it works publicly

- **Cloudflare DNS**: `CNAME incognito → <tunnel-id>.cfargotunnel.com`, proxied.
- **Privy allowed origins**: add `https://incognito.hence.markets`, or login fails on the
  deployed domain with a generic error.

## Checks

```bash
curl -s https://incognito.hence.markets/inc/health          # keeper up, cohort size
curl -s https://incognito.hence.markets/inc/epochs          # what it has netted
docker compose logs -f incognito-keeper                     # netting, live
```

A netted epoch prints `pair 0: 9 orders · crossed $27,500 · residual $12,600 → unfilled`.
