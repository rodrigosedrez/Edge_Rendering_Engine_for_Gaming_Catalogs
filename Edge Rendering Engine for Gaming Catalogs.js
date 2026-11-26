export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const path = url.pathname;
        const userAgent = request.headers.get("User-Agent") || "";

        // 1️⃣ ROBOTS.TXT EXCEPTION: Always process it, regardless of whether the request is from a bot or a user
        if (path === "/robots.txt") {
            const robotsContent = `# robots.txt para yoursite...`; // (your current content)
            return new Response(robotsContent, {
                headers: { "Content-Type": "text/plain; charset=utf-8" },
            });
        }

        // 2️⃣ BOT FILTER: If the request is NOT from a bot, exit the Worker IMMEDIATELY
        // and let Cloudflare Pages/the browser handle the regular application
        const bots = ["googlebot", "bingbot", "duckduckbot", "postmanruntime"];
        const isBot = bots.some(bot => userAgent.toLowerCase().includes(bot));

        if (!isBot) {
            return fetch(request); // Regular users pass through here without any changes!
        }

        // 3️⃣ FRAMEWORK STATIC FILE PROTECTION
        const isStaticFile = /\.(js|css|wasm|png|jpg|jpeg|gif|webp|svg|ico|json|txt|xml|woff|woff2|ttf)$/i.test(path);
        if (path.startsWith('/_framework/') || path.startsWith('/_content/') || isStaticFile) {
            return fetch(request);
        }

        // 🔄 4️⃣ C#-COMPATIBLE 301 REDIRECT (BOTS ONLY ON GAME ROUTES)
        if (path.startsWith("/games/")) {
            // Split the URL into parts to process the game slug while preserving the platform structure
            const parts = path.split("/").filter(Boolean);

            // Apply normalization exactly as in C#
            const cleanParts = parts.map((part, index) => {
                // Normalize the platform slug or game slug (elements after '/games/')
                if (index >= 1) {
                    let slug = part.toLowerCase(); // .ToLower()
                    slug = slug.replace(/--/g, "-"); // .Replace("--", "-")
                    slug = slug.replace(/,/g, ""); // .Replace(",", "")
                    slug = slug.replace(/[^a-z0-9\-]/g, ""); // Regex.Replace(..., @"[^a-z0-9\-]", "")
                    slug = slug.replace(/-+/g, "-"); // Regex.Replace(..., @"-+", "-")
                    slug = slug.replace(/^-+|-+$/g, ""); // .Trim('-')
                    return slug;
                }
                return part;
            });

            const normalizedPath = "/" + cleanParts.join("/");

            // Send a 301 redirect if the normalized path differs from the requested path
            if (normalizedPath !== path) {
                const redirectUrl = new URL(request.url);
                redirectUrl.pathname = normalizedPath;
                return Response.redirect(redirectUrl.toString(), 301);
            }
        }

        // 5️⃣ CLOUDFLARE KV READ AND LOOKUP
        const kvKey = `page:${path}`;
        try {
            const cachedHtml = await env.LRN_KV.get(kvKey);
            if (cachedHtml) {
                return new Response(cachedHtml, {
                    headers: {
                        "Content-Type": "text/html; charset=utf-8",
                        "Cache-Control": "public, max-age=3600"
                    }
                });
            }
        } catch (kvErr) {
            console.error("Error reading from KV (continuing with normal flow):", kvErr.message);
        }

        // 6️⃣ CLOUDFLARE NATIVE CACHE HANDLING
        const cache = caches.default;
        const cacheKey = new Request(request.url);

        let response = await cache.match(cacheKey);
        if (response) {
            return response;
        }

        // Default SEO structure (fallback)
        let seo = {
            title: "yoursite - Retro Games Catalog",
            desc: "Download safe and verified retro games.",
            body: "<h1>yoursite Library</h1><p>Loading gaming database...</p>"
        };

        let canonicalUrl = `https://www.yoursite.com${path === "/" || path === "/index.html" ? "/" : path}`;

        try {
            // 🏠 HOME PAGE
            if (path === "/" || path === "/index.html") {
                seo.title = "yoursite - Download Retro games & Emulators";
                seo.desc = "Explore classic games, emulators and retro gaming articles.";
                seo.body = "<h1>Welcome to yoursite</h1><p>Your best source for classic games.</p>";

                try {
                    const postsRes = await fetch("https://worker-api.yoursite.com/api/Posts/0/1", {
                        headers: { "Accept": "application/json" }
                    });

                    if (postsRes.ok) {
                        const postsData = await postsRes.json();
                        const posts = postsData.paginatedPosts || [];

                        if (posts.length > 0) {
                            const firstPost = posts[0];
                            seo.title = `yoursite Games games Emulators`;
                            seo.desc = firstPost.paragrathPreview || firstPost.paragraph1 || seo.desc;

                            seo.body += "<section><h2>Latest Posts</h2><ul>";
                            posts.slice(0, 5).forEach(post => {
                                const preview = post.paragrathPreview || post.paragraph1 || "";
                                seo.body += `
                  <li>
                    <h3>${post.title}</h3>
                    ${post.imageUrl1 ? `<img src="${post.imageUrl1}" alt="${post.title}" style="max-width:300px" />` : ""}
                    <p>${preview}</p>
                    <a href="/posts/${encodeURIComponent(post.slug)}">Read more</a>
                  </li>`;
                            });
                            seo.body += "</ul></section>";
                        }
                    }
                } catch (e) {
                    console.error("Error loading posts on the home page:", e.message);
                }
            }

            // 🎮 EMULATORS
            else if (path === "/emulators/" || path === "/emulators") {
                seo.title = "yoursite - Emulators";
                seo.desc = "Explore all the retro gaming platforms available on yoursite.";
                seo.body = "<h1>Platform Emulators</h1>";

                try {
                    const apiRes = await fetch("https://worker-api.yoursite.com/api/PlataformModels/0/150", {
                        headers: { "Accept": "application/json" }
                    });

                    if (apiRes.ok) {
                        const data = await apiRes.json();
                        const platforms = data.paginatedPlataforms || [];

                        if (platforms.length > 0) {
                            seo.body += "<section><ul>";
                            platforms.forEach(p => {
                                seo.body += `
                  <li>
                    <h2>${p.platformName}</h2>
                    <img src="${p.plataformGameImage}" alt="${p.platformName} logo" style="max-width:200px" />
                    <p>${p.platformDescription}</p>
                  </li>`;
                            });
                            seo.body += "</ul></section>";
                        }
                    }
                } catch (e) {
                    console.error("Error loading emulators:", e.message);
                }
            }

            // 🎮 POSTS
            else if (path === "/post/" || path === "/post") {
                seo.title = "yoursite - Posts";
                seo.desc = "Find news and Learn more about retro games ";
                seo.body = "<h1>Welcome to yoursite</h1><p>Your best source for classic games.</p>";

                try {
                    const postsRes = await fetch("https://worker-api.yoursite.com/api/Posts/0/1", {
                        headers: { "Accept": "application/json" }
                    });

                    if (postsRes.ok) {
                        const postsData = await postsRes.json();
                        const posts = postsData.paginatedPosts || [];

                        if (posts.length > 0) {
                            const firstPost = posts[0];
                            seo.title = `yoursite Games games Emulators`;
                            seo.desc = firstPost.paragrathPreview || firstPost.paragraph1 || seo.desc;

                            seo.body += "<section><h2>Latest Posts</h2><ul>";
                            posts.slice(0, 5).forEach(post => {
                                const preview = post.paragrathPreview || post.paragraph1 || "";
                                seo.body += `
                  <li>
                    <h3>${post.title}</h3>
                    ${post.imageUrl1 ? `<img src="${post.imageUrl1}" alt="${post.title}" style="max-width:300px" />` : ""}
                    <p>${preview}</p>
                    <a href="/posts/${encodeURIComponent(post.slug)}">Read more</a>
                  </li>`;
                            });
                            seo.body += "</ul></section>";
                        }
                    }
                } catch (e) {
                    console.error("Error loading posts on the home page:", e.message);
                }
            }

            // 💿 PLATFORMS (GAMES)
            else if (path === "/games/" || path === "/games") {
                seo.title = "yoursite - Platforms";
                seo.desc = "Explore all the retro gaming platforms available on yoursite.";
                seo.body = "<h1>Platforms</h1>";

                try {
                    const apiRes = await fetch("https://worker-api.yoursite.com/api/PlataformModels/0/150", {
                        headers: { "Accept": "application/json" }
                    });

                    if (apiRes.ok) {
                        const data = await apiRes.json();
                        const platforms = data.paginatedPlataforms || [];

                        if (platforms.length > 0) {
                            seo.body += "<section><ul>";
                            platforms.forEach(p => {
                                seo.body += `
                  <li>
                    <h2>${p.platformName}</h2>
                    <img src="${p.platafomGameLogo}" alt="${p.platformName} logo" style="max-width:200px" />
                    <p>${p.platformDescription}</p>
                  </li>`;
                            });
                            seo.body += "</ul></section>";
                        }
                    }
                } catch (e) {
                    console.error("Error loading games:", e.message);
                }
            }

            // 📑 GAME PAGINATION BY PLATFORM
            else if (/^\/games\/([^\/]+)\/(\d+)$/.test(path)) {
                const match = path.match(/^\/games\/([^\/]+)\/(\d+)$/);
                const platformSlug = match[1];
                const page = parseInt(match[2], 10);

                seo.title = `Popular games - ${platformSlug.toUpperCase()} | yoursite`;
                seo.desc = `See the popular games on ${platformSlug.toUpperCase()} page ${page}.`;
                seo.body = `<h1>Popular games - ${platformSlug.toUpperCase()}</h1>`;

                try {
                    const platRes = await fetch(`https://worker-api.yoursite.com/api/PlataformModels/Byslug/${platformSlug}`, {
                        headers: { "Accept": "application/json" }
                    });

                    if (platRes.ok) {
                        const platData = await platRes.json();
                        const plataformID = platData.id;

                        seo.body += `<h2>Platform description</h2><p>${platData.platformDescription || "No description"}</p>`;

                        let categoryId = null;

                        try {
                            const catRes = await fetch(`https://worker-api.yoursite.com/categoryByPlatform/${plataformID}/0/20`, {
                                headers: { "Accept": "application/json" }
                            });

                            if (catRes.ok) {
                                const catData = await catRes.json();
                                const categories = catData.paginatedGameCategories || catData || [];
                                if (Array.isArray(categories) && categories.length > 0) {
                                    categoryId = categories[0].id || categories[0].Id;
                                }
                            }
                        } catch (e) {
                            console.log("Error retrieving category.");
                        }

                        if (categoryId) {
                            const skip = (page - 1) * 36;
                            const take = 36;
                            const gamesUrl = `https://worker-api.yoursite.com/api/GameModelControllers/categoryPopular/${plataformID}/${categoryId}/${skip}/${take}`;
                            const gamesRes = await fetch(gamesUrl, { headers: { "Accept": "application/json" } });

                            if (gamesRes.ok) {
                                const data = await gamesRes.json();
                                const games = data.paginatedGames || data.PaginatedGames || data || [];

                                seo.body += "<h2>Games found</h2><ul>";
                                if (Array.isArray(games) && games.length > 0) {
                                    games.forEach(g => {
                                        const slug = g.slug || g.Slug || "";
                                        const name = g.gameName || g.GameName || "Unknown Game";
                                        if (slug) {
                                            const gameUrl = `https://www.yoursite.com/games/${platformSlug}/${slug}`;
                                            seo.body += `<li><a href="${gameUrl}">${name}</a></li>`;
                                        }
                                    });
                                } else {
                                    seo.body += `<li>No games found.</li>`;
                                }
                                seo.body += "</ul>";
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error loading paginated games:", e.message);
                }
            }

            // 🔹 GAME DETAIL
            else {
                const parts = path.split("/").filter(Boolean);

                if (parts.length < 3 || parts[0] !== "games") {
                    return new Response("Not Found", { status: 404 });
                }

                const platform = decodeURIComponent(parts[1] || "");
                const slug = decodeURIComponent(parts[parts.length - 1]);
                const readableName = slug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

                seo.title = `${readableName} game - ${platform.toUpperCase()} | yoursite`;
                seo.desc = `Download ${readableName} for ${platform.toUpperCase()} at yoursite.`;
                seo.body = `<h1>${readableName}</h1><p>Download ${readableName} for ${platform.toUpperCase()} at yoursite.</p>`;

                try {
                    const apiRes = await fetch(
                        `https://worker-api.yoursite.com/api/GameModelControllers/slug/${encodeURIComponent(slug)}`,
                        { headers: { "Accept": "application/json" } }
                    );

                    if (apiRes.ok) {
                        const data = await apiRes.json();

                        seo.title = `${data.gameName || readableName} game - ${(data.plataformSlug || platform).toUpperCase()} | yoursite`;
                        seo.desc = data.gameDescription || seo.desc;
                        seo.body = `
              <article>
                <h1>${data.gameName || readableName}</h1>
                ${data.imageBoxArt ? `<img src="${encodeURI(data.imageBoxArt)}" alt="${data.gameName}" style="max-width:300px" />` : ""}
                <p>${data.gameDescription || "No description available."}</p>
                <p>Platform: ${platform.toUpperCase()} | Language: ${data.gameLenguage || "English"}</p>
              </article>`;

                        try {
                            const gamesRes = await fetch(
                                `https://worker-api.yoursite.com/game/gameid/${data.id}/0/36`,
                                { headers: { "Accept": "application/json" } }
                            );

                            if (gamesRes.ok) {
                                const gamesData = await gamesRes.json();
                                const list = gamesData.paginatedgames || [];
                                if (list.length > 0) {
                                    seo.body += `<h2>Available games</h2><ul>`;
                                    list.forEach(game => {
                                        const downloadUrl = `https://worker-api.yoursite.com/api/Storage/download/${encodeURIComponent(game.gameFolder)}/${encodeURIComponent(game.gamesName)}`;
                                        seo.body += `<li><a href="${downloadUrl}" target="_blank">${game.gamesName}</a> (${game.gameSize || "N/A"})</li>`;
                                    });
                                    seo.body += `</ul>`;
                                }
                            }
                        } catch (gameErr) {
                            console.error("Error fetching game files:", gameErr.message);
                        }

                        const categories = data.gameCategoryModelIds || [];
                        if (categories.length > 0) {
                            const categoryId = categories.length > 1 ? categories[1] : categories[0];
                            try {
                                const extraRes = await fetch(
                                    `https://worker-api.yoursite.com/api/GameModelControllers/categoryPopularBest/${categoryId}/0/5`,
                                    { headers: { "Accept": "application/json" } }
                                );

                                if (extraRes.ok) {
                                    const extraData = await extraRes.json();
                                    let related = extraData.paginatedGames || [];

                                    const currentSlug = data.slug || slug;
                                    related = related.filter(game => {
                                        const gSlug = game.Slug || game.slug || '';
                                        return gSlug !== currentSlug;
                                    });

                                    related = related.slice(0, 4);

                                    if (related.length > 0) {
                                        seo.body += `<h2>Related Games</h2><ul>`;
                                        related.forEach(game => {
                                            const pSlug = game.PlataformSlug || game.plataformSlug || '';
                                            const gSlug = game.Slug || game.slug || '';
                                            const name = game.GameName || game.gameName || 'Unknown Game';
                                            const img = game.ImageBoxArt || game.imageBoxArt || '';
                                            const desc = game.GameDescription || game.gameDescription || '';
                                            const shortDesc = typeof desc === 'string' && desc.length > 0 ? desc.substring(0, 120) + '...' : '';

                                            seo.body += `
                        <li style="margin-bottom:12px;">
                          <a href="/games/${pSlug}/${gSlug}" style="display:flex;align-items:center;text-decoration:none;">
                            ${img ? `<img src="${encodeURI(img)}" alt="${name}" style="max-width:80px;margin-right:10px;" />` : ''}
                            <span>${name}</span>
                          </a>
                          ${shortDesc ? `<p style="margin:4px 0 0 90px;font-size:0.9em;color:#555;">${shortDesc}</p>` : ''}
                        </li>`;
                                        });
                                        seo.body += `</ul>`;
                                    }
                                }
                            } catch (extraErr) {
                                console.error("Error loading related games:", extraErr.message);
                            }
                        }
                    }
                } catch (e) {
                    console.error("Error searching for game details:", e.message);
                }
            }

        } catch (err) {
            console.error("Critical rendering error:", err.message);
        }

        // 7️⃣ BUILD THE FINAL HTML FOR BOTS
        const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${seo.title}</title>
  <meta name="description" content="${seo.desc.replace(/"/g, '').slice(0, 155)}" />
  <meta name="robots" content="index, follow" />
  <meta name="msvalidate.01" content="0d38b3e306fd4598bd975aa766b2771e" />
  <link rel="canonical" href="${canonicalUrl}" />
</head>
<body>
  <div id="app">${seo.body}</div>
</body>
</html>
`;

        // 8️⃣ SAVE TO CLOUDFLARE KV
        try {
            await env.LRN_KV.put(kvKey, html, { expirationTtl: 86400 });
        } catch (kvSaveErr) {
            console.error("Error saving to KV:", kvSaveErr.message);
        }

        // 9️⃣ CREATE THE CACHED RESPONSE
        const finalResponse = new Response(html, {
            headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "public, max-age=3600"
            }
        });

        await cache.put(cacheKey, finalResponse.clone());

        return finalResponse;
    }
};