const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const http = require("http");
const https = require("https");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Desencapsula os 302/307 intermediários do BestCine para entregar direto o MP4
function resolveFinalDirectUrl(urlStr, maxRedirects = 6) {
  return new Promise((resolve) => {
    function step(currentUrl, count) {
      if (count >= maxRedirects) return resolve(currentUrl);
      try {
        const u = new URL(currentUrl);
        const mod = u.protocol === "https:" ? https : http;
        const req = mod.request(
          u,
          {
            method: "GET",
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              Referer: "https://bestcine.dpdns.org/"
            }
          },
          (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              step(res.headers.location, count + 1);
            } else {
              resolve(currentUrl);
            }
          }
        );
        req.on("error", () => resolve(currentUrl));
        req.setTimeout(4500, () => {
          req.destroy();
          resolve(currentUrl);
        });
        req.end();
      } catch (e) {
        resolve(currentUrl);
      }
    }
    step(urlStr, 0);
  });
}

// ROTA DO SMART ROUTER - AUTO-PLAY DIRETO
app.get("/play/:type/:id/:quality", async (req, res) => {
  const { type, id, quality } = req.params;
  console.log(`[CineBR Smart Router] Solicitado stream para ${id} [${quality}]`);

  let candidateUrl = null;

  // 1. Tenta pegar os streams do BestCine primeiro (se não estiver bloqueado pelo Cloudflare)
  try {
    const bcRes = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 2500
    });

    const bcStreams = bcRes.data?.streams || [];
    const safira = bcStreams.find(
      (s) => s.url && s.title?.includes("Safira") && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p"))
    );
    const athena = bcStreams.find(
      (s) => s.url && s.title?.includes("Athena") && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p"))
    );
    const anyMatching = bcStreams.find(
      (s) => s.url && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p"))
    );
    const anyBc = bcStreams.find((s) => s.url);

    const chosen = safira || athena || anyMatching || anyBc;
    if (chosen?.url) {
      candidateUrl = chosen.url;
    }
  } catch (err) {
    // BestCine bloqueou o IP do datacenter ou caiu
  }

  // 2. Failover permanente e instantâneo para AllDebrid (Nuvem sem bloqueios 24/7)
  if (!candidateUrl) {
    try {
      const providers =
        "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
      const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;
      const resAd = await axios.get(debridUrl, { timeout: 4000 });
      const rawStreams = resAd.data?.streams || [];

      // Filtra animações indesejadas e pacotes velhos
      const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
      const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

      const ptStreams = validStreams.filter((s) =>
        /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`)
      );

      // Prioriza a qualidade pedida
      let chosenAd = null;
      if (quality === "4k") {
        chosenAd = ptStreams.find((s) => /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`)) || ptStreams[0];
      } else {
        chosenAd =
          ptStreams.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`)) ||
          ptStreams[0] ||
          validStreams.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`));
      }

      if (!chosenAd) {
        chosenAd = ptStreams[0] || validStreams[0] || rawStreams[0];
      }

      if (chosenAd?.url) {
        candidateUrl = chosenAd.url;
      }
    } catch (errAd) {
      console.error("[CineBR Router] Erro consultando AllDebrid:", errAd.message);
    }
  }

  if (!candidateUrl) {
    return res.status(404).send("Nenhum servidor disponível no momento.");
  }

  // Se for do BestCine, desencapsula. Se for do AllDebrid, entrega direto.
  if (candidateUrl.includes("bestcine.dpdns.org")) {
    const finalDirectUrl = await resolveFinalDirectUrl(candidateUrl);
    return res.redirect(302, finalDirectUrl);
  }

  // Redireciona o player imediatamente (AllDebrid CDN de altíssima velocidade)
  res.redirect(302, candidateUrl);
});

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "14.3.0",
  name: "CineBR ⚡ Smart Cloud (Dublado & 4K)",
  description: "Addon permanente na nuvem 24/7 sem bloqueio. Auto-Play inteligente direto no melhor servidor.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR Cloud] Gerando stream unificado para ${type} ID: ${id}`);
  
  // Link fixo permanente na Nuvem (Render / HTTPS Oficial)
  const baseUrl = "https://cinebr-addon.onrender.com";

  const streams = [
    {
      name: "⚡ CineBR [AUTO-PLAY]",
      title: "🎬 REPRODUÇÃO INSTANTÂNEA • 1080p FULL HD\n🇧🇷 100% Dublado • Sem Seeds\n⚡ Nuvem 24/7 Permanente (Zero Buffering)",
      url: `${baseUrl}/play/${type}/${id}/1080p`,
      behaviorHints: {
        bingeGroup: `cinebr-auto-1080p-${id}`,
        notWebReady: false
      }
    },
    {
      name: "💎 CineBR [AUTO-PLAY 4K]",
      title: "🎬 REPRODUÇÃO 4K HDR UHD\n🇧🇷 100% Dublado • Sem Seeds\n⚡ Máxima Definição 4K Instantânea",
      url: `${baseUrl}/play/${type}/${id}/4k`,
      behaviorHints: {
        bingeGroup: `cinebr-auto-4k-${id}`,
        notWebReady: false
      }
    }
  ];

  return { streams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 14.3 Cloud Permanente rodando na porta ${PORT}`);
});
