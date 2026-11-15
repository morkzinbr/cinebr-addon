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
        req.setTimeout(4000, () => {
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

function parseSize(s) {
  const match = (s.title || "").match(/💾\s*([\d\.]+)\s*(GB|MB)/i);
  if (!match) return 999;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "MB" ? num / 1024 : num;
}

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "18.0.0",
  name: "CineBR ⚡ Duas Opções (1080p & 4K)",
  description: "Exatamente 2 opções limpas: 1080p Full HD (Projetor/Celular) e 4K HDR (Smart TV).",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 18.0] Buscando streams para ${type} ID: ${id}`);
  let stream1080 = null;
  let stream4k = null;

  // 1. TENTA PRIMEIRO NO BESTCINE
  try {
    const bcRes = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 2500
    });

    const bcStreams = bcRes.data?.streams || [];
    const bc1080 = bcStreams.find((s) => s.url && s.title?.includes("Safira") && s.name?.includes("1080p")) ||
                   bcStreams.find((s) => s.url && s.title?.includes("Athena") && s.name?.includes("1080p")) ||
                   bcStreams.find((s) => s.url && s.name?.includes("1080p"));

    const bc4k = bcStreams.find((s) => s.url && s.title?.includes("Safira") && s.name?.includes("4K")) ||
                 bcStreams.find((s) => s.url && s.title?.includes("Athena") && s.name?.includes("4K")) ||
                 bcStreams.find((s) => s.url && s.name?.includes("4K"));

    if (bc1080) {
      const directUrl = await resolveFinalDirectUrl(bc1080.url);
      stream1080 = {
        name: "⚡ CineBR [1080p FULL HD]",
        title: "🎬 1080p FULL HD • ÁUDIO DUBLADO (BRASIL)\n⚡ Otimizado para Projetor e Celular (Zero Travamento)",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      };
    }

    if (bc4k) {
      const directUrl = await resolveFinalDirectUrl(bc4k.url);
      stream4k = {
        name: "💎 CineBR [4K HDR ULTRA]",
        title: "🎬 4K HDR ULTRA HD • ÁUDIO DUBLADO (BRASIL)\n⚡ Máxima Definição para Smart TV",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      };
    }
  } catch (e) {}

  // 2. SE FALTAR 1080p OU 4K (OU RODANDO NA NUVEM), COMPLETA COM ALLDEBRID NATIVO 24/7
  if (!stream1080 || !stream4k) {
    try {
      const providers =
        "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
      const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

      const resAd = await axios.get(debridUrl, { timeout: 4000 });
      const rawStreams = resAd.data?.streams || [];

      // Filtra animações e coleções velhas
      const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
      const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

      function isRealPt(s) {
        const title = `${s.name || ""} ${s.title || ""}`;
        if (/(cinecalidad|dual-lat|\.lat\.|latino|castellano|espanol|spanish|mexico|argentina)/i.test(title)) {
          return false;
        }
        return /(dublado|comando|bludv|micoleao|pt-br|ptbr|portuguese|multi.*ben the men|multi\[ben the men\]|\.por\.)/i.test(title) || s.title?.includes("🇵🇹") || s.title?.includes("🇧🇷");
      }

      function isCamQuality(s) {
        const text = `${s.name || ""} ${s.title || ""}`.toLowerCase();
        return /\b(camrip|telesync|hdcam|hdts)\b/i.test(text) || /\bcam\b/i.test(s.name || "");
      }

      // --- BUSCA O MELHOR 1080p ---
      if (!stream1080) {
        // Prioriza 1080p Dublado leve
        const pt1080 = validStreams.filter((s) => isRealPt(s) && /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const any1080 = validStreams.filter((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const cam1080 = validStreams.filter((s) => isCamQuality(s));

        const chosen1080 = pt1080.find((s) => parseSize(s) <= 12) || pt1080[0] ||
                           any1080.find((s) => parseSize(s) <= 8) || any1080[0] ||
                           cam1080[0];

        if (chosen1080) {
          const isDub = isRealPt(chosen1080);
          const isCam = isCamQuality(chosen1080);
          const qName = isCam ? "CINEMA CAM" : "1080p FULL HD";
          const aName = isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL / LEGENDADO";

          stream1080 = {
            name: `⚡ CineBR [${qName}]`,
            title: `🎬 1080p • ${aName}\n⚡ ${chosen1080.title.split('\n')[0]}\n⚡ Otimizado para Projetor (Leve & Sem Travamentos)`,
            url: chosen1080.url,
            behaviorHints: chosen1080.behaviorHints || { notWebReady: false }
          };
        }
      }

      // --- BUSCA O MELHOR 4K ---
      if (!stream4k) {
        const pt4k = validStreams.filter((s) => isRealPt(s) && /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const any4k = validStreams.filter((s) => /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));

        const chosen4k = pt4k[0] || any4k[0];
        if (chosen4k) {
          const isDub = isRealPt(chosen4k);
          const aName = isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL / LEGENDADO";

          stream4k = {
            name: "💎 CineBR [4K HDR ULTRA]",
            title: `🎬 4K UHD • ${aName}\n⚡ ${chosen4k.title.split('\n')[0]}\n⚡ Máxima Definição para Smart TV`,
            url: chosen4k.url,
            behaviorHints: chosen4k.behaviorHints || { notWebReady: false }
          };
        }
      }
    } catch (err) {
      console.error("[CineBR 18.0] Erro:", err.message);
    }
  }

  // RETORNA EXATAMENTE AS DUAS OPÇÕES LIMPAS
  const finalStreams = [];
  if (stream1080) finalStreams.push(stream1080);
  if (stream4k) finalStreams.push(stream4k);

  // Se por algum motivo só achou uma qualidade (ex: filme velho que não tem 4K), entrega a disponível
  return { streams: finalStreams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 18.0 Duas Opções rodando na porta ${PORT}`);
});
