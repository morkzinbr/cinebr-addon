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
  version: "17.1.0",
  name: "CineBR ⚡ Cloud 24/7 (Dublado & Projetor)",
  description: "Link permanente na nuvem sem precisar do PC ligado. 100% Dublado PT-BR e Otimizado para Projetor.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 17.1 Cloud] Buscando streams para ${type} ID: ${id}`);
  const streams = [];

  // 1. TENTA BESTCINE (SE ESTIVER LOCAL OU COM PROXY)
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
      streams.push({
        name: "⚡ CineBR [1080p PROJETOR]",
        title: "🎬 1080p FULL HD • ÁUDIO DUBLADO (BRASIL)\n⚡ Otimizado para Projetor e Celular (Zero Travamento)",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      });
    }

    if (bc4k) {
      const directUrl = await resolveFinalDirectUrl(bc4k.url);
      streams.push({
        name: "💎 CineBR [4K ULTRA TV]",
        title: "🎬 4K HDR ULTRA HD • ÁUDIO DUBLADO (BRASIL)\n⚡ Máxima Definição para Smart TV",
        url: directUrl,
        behaviorHints: { notWebReady: false }
      });
    }
  } catch (e) {}

  // 2. SE NÃO VEIO DO BESTCINE (EX: NA NUVEM DO RENDER), USA O ALLDEBRID NATIVO 24/7
  if (streams.length === 0) {
    try {
      const providers =
        "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
      const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

      const resAd = await axios.get(debridUrl, { timeout: 4000 });
      const rawStreams = resAd.data?.streams || [];

      // Filtra animações e coleções intrusas
      const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
      const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

      // Validação estrita de Português (ignora espanhol/cinecalidad/dual-lat)
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

      const ptStreams = validStreams.filter((s) => isRealPt(s) && !isCamQuality(s));
      const originalHd = validStreams.filter((s) => !isCamQuality(s));
      const anyCam = validStreams.filter((s) => isCamQuality(s));

      const pool = ptStreams.length > 0 ? ptStreams : (originalHd.length > 0 ? originalHd : anyCam);

      // 1. Opção 1080p Leve para Projetor (reprodução suave)
      const fhdStream = pool.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && parseSize(s) <= 12) ||
                        pool.find((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`));

      // 2. Opção 4K HDR para Smart TV
      const k4Stream = pool.find((s) => /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`));

      if (fhdStream) {
        const isDub = isRealPt(fhdStream);
        const isCam = isCamQuality(fhdStream);
        let qTag = isCam ? "CINEMA CAM" : "1080p PROJETOR";
        let aTag = isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL / LEGENDADO";

        streams.push({
          name: `⚡ CineBR [${qTag}]`,
          title: `🎬 ${fhdStream.title.split('\n')[0]}\n${aTag} • ALLDEBRID 24/7\n⚡ Otimizado para Projetor (Leve & Sem Travamentos)`,
          url: fhdStream.url,
          behaviorHints: fhdStream.behaviorHints || { notWebReady: false }
        });
      }

      if (k4Stream && k4Stream !== fhdStream) {
        const isDub = isRealPt(k4Stream);
        streams.push({
          name: "💎 CineBR [4K ULTRA TV]",
          title: `🎬 ${k4Stream.title.split('\n')[0]}\n${isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL"} • ALLDEBRID 24/7\n⚡ Máxima Definição 4K HDR`,
          url: k4Stream.url,
          behaviorHints: k4Stream.behaviorHints || { notWebReady: false }
        });
      }

      // Se não achou nem 1080p nem 4k, pega o primeiro da pool
      if (streams.length === 0 && pool.length > 0) {
        const first = pool[0];
        streams.push({
          name: "⚡ CineBR [PLAY DIRETO]",
          title: `🎬 ${first.title.split('\n')[0]}\nALLDEBRID 24/7 NUVEM`,
          url: first.url,
          behaviorHints: first.behaviorHints || { notWebReady: false }
        });
      }
    } catch (err) {
      console.error("[CineBR] Erro Debrid Nuvem:", err.message);
    }
  }

  return { streams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 17.1 Universal Cloud rodando na porta ${PORT}`);
});
