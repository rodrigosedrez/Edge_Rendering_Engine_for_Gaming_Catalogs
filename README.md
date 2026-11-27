<div align="center">

# ⚡ Edge Rendering Engine for Gaming Catalogs

**A Cloudflare Worker that dynamically generates SEO-friendly HTML for search engine crawlers while preserving the SPA experience for real users.**

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020)
![Workers KV](https://img.shields.io/badge/Edge_storage-Workers_KV-F38020)
![Cache API](https://img.shields.io/badge/Edge_cache-Cache_API-F38020)
![JavaScript](https://img.shields.io/badge/JavaScript-ES_Modules-F7DF1E)
![Blazor](https://img.shields.io/badge/Frontend-Blazor_WebAssembly-512BD4)
![SEO](https://img.shields.io/badge/Focus-Technical_SEO-2E7D32)
![License](https://img.shields.io/badge/license-MIT-green)

</div>

---

## 📖 Overview

Single Page Applications such as Blazor WebAssembly have an SEO problem: a crawler first receives a minimal HTML shell and must run JavaScript and load the .NET runtime before it can discover any content.

This Worker solves that at the edge:

- It **detects search engine bots**
- It **fetches the content from an external catalog API**
- It **generates a fully rendered HTML page** with SEO metadata
- It **stores the page in Workers KV** and the **Cloudflare Cache API**
- It **returns crawlable content** to the search engine

Regular users keep receiving the original SPA, unchanged.

> [!IMPORTANT]
> **This is the original version (v1) of the Worker, kept as a record of how the work started.**
>
> - It was my **first Cloudflare Worker**, written while I identified the SEO problems of the site one by one, tested each fix, and corrected what did not work. It is **partly functional** and shows the **progress and the methodology**, not a finished product.
> - It was made for **one specific system**. Routes, API endpoints, JSON field names, slug rules, and page templates belong to that catalog and its API. It is **not meant to work on any website**, but it can be used as a base to understand how the pieces fit together.
> - A **refactored version** (configuration through environment variables, shared helpers, tests) **will be published separately**. This repository is its origin, and I keep it as it was on purpose, so the evolution is visible.
> - **Some parts are specific to the original system** and would have to be replaced in any other project: the `LRN_KV` binding name, a Bing site-verification tag, some page texts, and one section of the game page that lists files from the original system's storage endpoint. They are called out in [Known limitations](#-known-limitations).

## 🎯 The problem

A typical Blazor WebAssembly application answers a crawler with:

```html
<div id="app">Loading...</div>
```

That leads to:

- Delayed indexing
- Missing metadata (title, description, canonical)
- Poor crawl efficiency
- **Duplicate URL issues**: the same page reachable under several URL forms
- Incomplete search results

## 🏗️ Architecture

```
                 Googlebot / Bingbot
                        │
                        ▼
              Cloudflare Worker
                        │
       ┌────────────────┼─────────────────┐
       ▼                ▼                 ▼
  Workers KV        Cache API        Catalog API
       │                                  │
       └──────────────┬───────────────────┘
                      ▼
               Rendered HTML
                      │
                      ▼
               Search engine
```

Regular visitors skip the rendering layer entirely:

```
Visitor ──▶ fetch(request) ──▶ Blazor WebAssembly SPA
```

## ✨ Features

- Bot-specific dynamic prerendering
- Workers KV (durable) and Cloudflare Cache API (edge) caching
- URL normalization with `301` redirects to the canonical URL
- Dynamic `title`, `meta description`, and `canonical` generation
- Platform, catalog, and detail page generation
- Related items and internal links for crawlability
- `robots.txt` support
- Graceful degradation: every API call has a fallback

## 🔄 Request flow

```
                          Incoming request
                                │
                  ┌─────────────▼──────────────┐
            1     │  /robots.txt ?             │── yes ──▶ static robots.txt response
                  └─────────────┬──────────────┘
                                │ no
                  ┌─────────────▼──────────────┐
            2     │  Is the user agent a bot?  │── no ───▶ fetch(request)  (normal app)
                  └─────────────┬──────────────┘
                                │ yes
                  ┌─────────────▼──────────────┐
            3     │  Framework / static file?  │── yes ──▶ fetch(request)
                  └─────────────┬──────────────┘
                                │ no
                  ┌─────────────▼──────────────┐
            4     │  /games/* not canonical?   │── yes ──▶ 301 redirect to canonical URL
                  └─────────────┬──────────────┘
                                │ no
                  ┌─────────────▼──────────────┐
            5     │  Workers KV hit?           │── yes ──▶ return stored HTML
                  └─────────────┬──────────────┘
                                │ no
                  ┌─────────────▼──────────────┐
            6     │  Cache API hit?            │── yes ──▶ return cached response
                  └─────────────┬──────────────┘
                                │ no
                  ┌─────────────▼──────────────┐
            7     │  Fetch API data and build  │
                  │  the SEO content           │
                  └─────────────┬──────────────┘
                  ┌─────────────▼──────────────┐
            8     │  Assemble the final HTML   │
                  └─────────────┬──────────────┘
                  ┌─────────────▼──────────────┐
            9     │  Save to KV + Cache API    │──▶ return HTML
                  └────────────────────────────┘
```

## 🔍 Step by step

The numbers follow the order of the stages **in the code**. Open each step to see what it does and which problem it addresses.

<details>
<summary><b>1️⃣ robots.txt exception</b></summary>

`/robots.txt` is answered directly by the Worker for **everyone**, bot or not, as `text/plain`. It runs first so the file is always available and never depends on the SPA. In this repository the content is a placeholder.

</details>

<details>
<summary><b>2️⃣ Bot filter</b></summary>

The `User-Agent` is compared (case-insensitive) with a short list: `googlebot`, `bingbot`, `duckduckbot`, and `postmanruntime`. A request that is **not** from a bot returns `fetch(request)` immediately, so people receive the normal Blazor application with no extra latency and no behavior change.

`postmanruntime` is in the list **to test the bot behavior from Postman**, without having to wait for a real crawler. It should not stay in a production setup.

**Problem addressed:** the SPA must not change for real users, and the rendering cost must be paid only for crawlers.

</details>

<details>
<summary><b>3️⃣ Framework and static file protection</b></summary>

Even for bots, requests that are not pages go to the origin untouched: anything under `/_framework/` or `/_content/` (Blazor runtime files) and any path ending in `js, css, wasm, png, jpg, jpeg, gif, webp, svg, ico, json, txt, xml, woff, woff2, ttf`.

**Problem addressed:** without this step the Worker would try to "render" files such as the Blazor runtime as if they were pages.

</details>

<details>
<summary><b>4️⃣ Slug normalization and 301 redirect</b></summary>

For paths that start with `/games/`, every segment after the first (platform slug and game slug) is normalized with the same rules the backend uses to generate slugs:

1. lowercase
2. replace `--` with `-`
3. remove commas
4. remove any character outside `a-z`, `0-9`, and `-`
5. collapse repeated hyphens
6. trim hyphens at both ends

If the normalized path differs from the requested one, the Worker answers with a **`301` redirect** to the canonical URL.

**Problem addressed:** the same page could be reached through more than one URL (uppercase, double hyphens, commas, special characters). Duplicate URLs split ranking signals and hurt indexing. The rules must match the backend exactly, otherwise the Worker would redirect to URLs that do not exist.

</details>

<details>
<summary><b>5️⃣ Workers KV lookup</b></summary>

The key is `page:{pathname}`. If an HTML document is stored for the path, it is returned immediately as `text/html` with `Cache-Control: public, max-age=3600`.

KV is the **durable layer**: it survives across Cloudflare locations and deployments. The read is wrapped in `try/catch`: if KV fails, the error is logged and the flow continues as if the page were not cached.

**Problem addressed:** avoid calling the catalog API again for a page that was already rendered.

</details>

<details>
<summary><b>6️⃣ Cloudflare Cache API lookup</b></summary>

If KV had nothing, the Worker checks `caches.default` using the request URL. This is the **fast, per-location layer**.

**Problem addressed:** serve repeated crawler requests from the edge, without any other work.

</details>

<details>
<summary><b>7️⃣ Building the SEO content</b></summary>

On a full miss, the Worker starts from a **default fallback** (generic title, description, and body), computes the **canonical URL** from the path, and picks a template by route. Each API call has its own `try/catch`, so if an endpoint fails the page degrades to the fallback instead of failing.

Route order matters: `/games/{platform}/{digits}` is matched before the detail route, so `/games/snes/2` is a pagination page and `/games/snes/some-game` is a detail page. Other paths with fewer than three segments return `404`.

**Problem addressed:** give crawlers real content, metadata, and internal links for each page type.

</details>

<details>
<summary><b>8️⃣ Final HTML</b></summary>

The content is wrapped in a complete document: `<title>`, a `meta description` (quotes removed and truncated to 155 characters), `robots: index, follow`, a **`canonical`** link, and the body inside `<div id="app">`. The page is plain HTML with no JavaScript, so a crawler can read it with a single request.

</details>

<details>
<summary><b>9️⃣ Save and respond</b></summary>

The HTML is stored in **KV with a 24-hour TTL** and in the **Cache API** (`Cache-Control: public, max-age=3600`), then returned. The KV write is wrapped in `try/catch`, so the response is returned even if the write fails.

</details>

## 🧭 Route coverage

| Route                        | Generates                                                                        | API data used                                           |
| ---------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `/`                          | SEO title and description, latest posts with image, preview, and link            | `GET /api/Posts/0/1`                                    |
| `/emulators`                 | List of platforms with logo and description                                      | `GET /api/PlataformModels/0/150`                        |
| `/post`                      | Posts landing page                                                               | `GET /api/Posts/0/1`                                    |
| `/games`                     | List of platforms with logo and description                                      | `GET /api/PlataformModels/0/150`                        |
| `/games/{platform}/{page}`   | Platform overview and a page of 36 popular games with links                      | platform by slug → platform categories → popular games  |
| `/games/{platform}/{slug}`   | Game name, cover image, description, platform, language, file list, related games | game by slug → game files → related games by category   |

## 🚀 SEO output

For each page the Worker generates:

```html
<title>Game Name game - PLATFORM | yoursite</title>
<meta name="description" content="..." />          <!-- up to 155 characters -->
<meta name="robots" content="index, follow" />
<link rel="canonical" href="https://www.yoursite.com/games/platform/game-name" />
```

plus headings, text, images, and **internal links** built from the API data.

## ⚡ Caching strategy

| Layer          | Key                 | Lifetime                              | Role                                       |
| -------------- | ------------------- | ------------------------------------- | ------------------------------------------ |
| Workers KV     | `page:{pathname}`   | 24 hours (`expirationTtl: 86400`)     | Durable store, shared across locations     |
| Cache API      | request URL         | 1 hour                                | Fast per-location cache                    |
| HTTP header    | n/a                 | `Cache-Control: public, max-age=3600` | Reuse by crawlers and proxies              |

There is no manual invalidation: a page is refreshed when its KV entry expires or when the key is deleted.

## ☁️ Configuration and deployment

The domains are **placeholders written in the code**: `https://www.yoursite.com` (site) and `https://worker-api.yoursite.com` (catalog API). Replace them with search and replace.

`wrangler.toml`:

```toml
name = "edge-rendering-engine"
main = "Edge_Rendering_Engine_for_Gaming_Catalogs.js"
compatibility_date = "2025-01-01"

# The code reads the namespace as env.LRN_KV
kv_namespaces = [
  { binding = "LRN_KV", id = "<your-kv-namespace-id>" }
]

routes = [
  { pattern = "www.yoursite.com/*", zone_name = "yoursite.com" }
]
```

```bash
npm install -g wrangler
wrangler login
wrangler kv namespace create LRN_KV     # copy the returned id into wrangler.toml
wrangler deploy
```

## 🧪 Testing

```bash
# Regular visitor: the normal application shell
curl https://www.yoursite.com/games/some-platform/some-game

# Crawler simulation: pre-rendered HTML
curl -A "Googlebot" https://www.yoursite.com/games/some-platform/some-game

# Slug normalization: expect a 301 to the canonical URL
curl -I -A "Googlebot" "https://www.yoursite.com/games/Some--Platform/Game--Name"
```

Also use **URL Inspection** in Google Search Console and compare the rendered HTML with what users see.

## 🛠️ How this was built

The Worker grew **step by step**, as real SEO problems of the site were identified:

1. I observed how the site behaved with search engines and identified a requirement or a problem.
2. I isolated it and **tested** it, simulating crawler requests (the `postmanruntime` entry in the bot list comes from this).
3. I **fixed one problem at a time**, keeping each fix as its own stage in the request flow, which is why the code reads as a pipeline of small, single-purpose steps.
4. **AI assistance generated parts of the code.** I validated, tested, and corrected specific elements so they worked with my system: the API's JSON shape, the slug rules, the Blazor routes, and the Cloudflare environment.

The result favors clarity over abstraction: a single file, with the stages in the order in which the problems were solved. That is also why it still has duplicated blocks and naming inconsistencies. The refactored version will address them.

## 🔧 Using it as a base

If you want to adapt the ideas to your own system, these are the parts that are tied to this catalog:

1. **Routes**: the route chain in step 7.
2. **API calls and JSON fields**: names such as `paginatedPlataforms`, `platformName`, `gameName`, or `imageBoxArt`.
3. **Slug rules**: step 4 must match **your** slug generation exactly.
4. **Templates**: the HTML strings are intentionally simple.
5. **Bot list and TTLs**: adjust to your traffic and how often the content changes.

The **method** carries over to any SPA: intercept crawlers only, protect static assets, normalize URLs before anything else, use two cache layers, and degrade gracefully when the API fails.

## ⚠️ Known limitations

- **Specific to the original system.** The `LRN_KV` binding name, the Bing verification tag (`msvalidate.01`) in the HTML head, several page texts, and the file list in the game page (which links to the original system's storage endpoint) must be replaced in any other project.
- **HTML is not escaped.** Values from the API are inserted directly into the HTML. This is acceptable only while the content is trusted (written by admins).
- **Bot-only rendering is a workaround.** It is safe only if the content shown to crawlers is equivalent to what users see. Server-side rendering or static generation is the long-term alternative.
- **Small bot list**: Googlebot, Bingbot, DuckDuckBot (and Postman for tests).
- **Partial route coverage.** The home page links to `/posts/{slug}`, but there is no template for individual posts, so that path ends in `404` for bots.
- **Pagination pages use only the first category** returned for the platform.
- **The KV key ignores the query string**, and there is no manual cache invalidation.
- **Duplicated code** in the home and `/post` templates and in the platform lists of `/emulators` and `/games`.
- **Hard-coded domains and texts** instead of environment variables.

## 🗺️ Roadmap (refactored version)

- [ ] Move configuration (domains, API base URL, site name, KV binding) to environment variables
- [ ] Create reusable rendering helpers (API fetch, list rendering, HTML shell)
- [ ] Escape all API values before building the HTML
- [ ] Add templates for individual posts and emulators
- [ ] Add JSON-LD structured data and Open Graph metadata
- [ ] Add sitemap-aware rendering
- [ ] Implement a stale-while-revalidate strategy
- [ ] Improve bot detection
- [ ] Add automated tests (`vitest` with `@cloudflare/vitest-pool-workers`)

## 🛠️ Tech stack

| Area          | Technology                      |
| ------------- | ------------------------------- |
| Edge runtime  | Cloudflare Workers              |
| Edge storage  | Workers KV                      |
| Edge cache    | Cloudflare Cache API            |
| Frontend      | Blazor WebAssembly              |
| Backend       | ASP.NET Core Web API            |
| Goal          | Technical SEO and indexing      |

## 📄 License

Released under the MIT License.
