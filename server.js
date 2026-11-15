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

// Desencapsula os 302/307 do BestCine para entregar direto o MP4 CDN
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
  version: "17.0.0",
  name: "CineBR ⚡ Universal (Dublado PT-BR)",
  description: "Totalmente inteligente: 1080p nativo para projetores/celulares e 4K HDR para TVs, 100% Dublado PT-BR.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR Universal 17.0] Buscando streams para ${type} ID: ${id}`);
  const streams = [];

  // ==========================================
  // FONTE 1: BESTCINE (Áudio 100% Dublado PT-BR em MP4 CDN Leve)
  // ==========================================
  try {
    const bcRes = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 3000
    });

    const bcStreams = bcRes.data?.streams || [];
    
    // 1. Procura opção 1080p (ideal para projetor, não trava nunca)
    const bc1080 = bcStreams.find((s) => s.url && s.title?.includes("Safira") && s.name?.includes("1080p")) ||
                   bcStreams.find((s) => s.url && s.title?.includes("Athena") && s.name?.includes("1080p")) ||
                   bcStreams.find((s) => s.url && s.name?.includes("1080p"));

    // 2. Procura opção 4K
    const bc4k = bcStreams.find((s) => s.url && s.title?.includes("Safira") && s.name?.includes("4K")) ||
                 bcStreams.find((s) => s.url && s.title?.includes("Athena") && s.name?.includes("4K")) ||
                 bcStreams.find((s) => s.url && s.name?.includes("4K"));

    if (bc1080) {
      const directUrl = await resolveFinalDirectUrl(bc1080.url);
      streams.push({
        name: "⚡ CineBR [1080p PROJETOR/CELULAR]",
        title: "🎬 1080p FULL HD • ÁUDIO 100% DUBLADO (BRASIL)\n⚡ Otimizado para Projetor e Celular (Zero Travamento)",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      });
    }

    if (bc4k) {
      const directUrl = await resolveFinalDirectUrl(bc4k.url);
      streams.push({
        name: "💎 CineBR [4K HDR ULTRA]",
        title: "🎬 4K HDR ULTRA HD • ÁUDIO 100% DUBLADO (BRASIL)\n⚡ Máxima Definição para Smart TV",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      });
    }
  } catch (e) {
    console.error("[CineBR] BestCine indisponível:", e.message);
  }

  // ==========================================
  // FONTE 2: ALLDEBRID (Lançamentos / Blu-Rays / CAM)
  // ==========================================
  if (streams.length === 0) {
    try {
      const providers =
        "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
      const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

      const resAd = await axios.get(debridUrl, { timeout: 4000 });
      const rawStreams = resAd.data?.streams || [];

      // Filtra coleções antigas e animações intrusas
      const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
      const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

      // Filtro rigoroso: NÃO aceitar Espanhol/Latino (Cinecalidad / dual-lat) como se fosse PT-BR!
      function isRealPtBr(s) {
        const title = `${s.name || ""} ${s.title || ""}`;
        if (/(cinecalidad|dual-lat|\.lat\.|latino|castellano|espanol|spanish|mexico|argentina)/i.test(title)) {
          return false;
        }
        return /(dublado|comando|bludv|micoleao|pt-br|ptbr|portuguese|\.por\.)/i.test(title);
      }

      function isCamQuality(s) {
        const text = `${s.name || ""} ${s.title || ""}`.toLowerCase();
        return /\b(camrip|telesync|hdcam|hdts)\b/i.test(text) || /\bcam\b/i.test(s.name || "");
      }

      const ptStreams = validStreams.filter((s) => isRealPtBr(s) && !isCamQuality(s));
      const originalHd = validStreams.filter((s) => !isCamQuality(s));
      const anyCam = validStreams.filter((s) => isCamQuality(s));

      // Seleciona 1080p leve (perfeito para o projetor)
      const pool = ptStreams.length > 0 ? ptStreams : (originalHd.length > 0 ? originalHd : anyCam);
      
      // Procura primeiro versão 1080p leve (< 8 GB)
      const opt1080 = pool.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && parseSize(s) <= 8) ||
                      pool.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`)) ||
                      pool[0];

      if (opt1080) {
        const isDub = isRealPtBr(opt1080);
        const is4k = /(4k|2160p|uhd)/i.test(`${opt1080.name || ""} ${opt1080.title || ""}`);
        const isCam = isCamQuality(opt1080);

        let qTag = is4k ? "4K UHD" : (isCam ? "CINEMA CAM" : "1080p PROJETOR");
        let aTag = isDub ? "🇧🇷 100% DUBLADO" : "🌐 ÁUDIO ORIGINAL / LEGENDADO";

        streams.push({
          name: `⚡ CineBR [${qTag}]`,
          title: `🎬 ${opt1080.title.split('\n')[0]}\n${aTag} • REPRODUÇÃO DIRETA ALLDEBRID\n⚡ Arquivo Leve Otimizado (Sem Travamentos)`,
          url: opt1080.url,
          behaviorHints: opt1080.behaviorHints || { notWebReady: false }
        });
      }
    } catch (err) {
      console.error("[CineBR] Erro Debrid:", err.message);
    }
  }

  return { streams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 17.0 Universal rodando na porta ${PORT}`);
});
