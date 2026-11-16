const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");
const http = require("http");
const https = require("https");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";
const TUNNEL_URL = "https://medicare-mart-corrections-contains.trycloudflare.com";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Resolve redirect (301/302/307) para capturar o MP4 final
async function resolveDirectTarget(urlStr) {
  try {
    const res = await axios.get(urlStr, {
      maxRedirects: 0,
      validateStatus: () => true,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 2500
    });
    return res.headers.location || urlStr;
  } catch (e) {
    return urlStr;
  }
}

// Encontra a melhor stream (1080p ou 4K) do BestCine, resolvendo para o link MP4 final
async function selectResolvedBestCineStream(rawStreams, is4k) {
  const candidates = rawStreams.filter((s) => {
    const qMatch = is4k ? /(4k|2160p|uhd)/i.test(s.name) : /(1080p|fhd)/i.test(s.name);
    return s.url && qMatch;
  });

  // Prioriza Servidor Safira e Athena (são os que entregam o vídeo completo imediatamente sem timeout)
  candidates.sort((a, b) => {
    const score = (s) => (s.title?.includes("Safira") ? 1 : s.title?.includes("Athena") ? 2 : s.title?.includes("Selene") ? 3 : 4);
    return score(a) - score(b);
  });

  for (const cand of candidates) {
    const directUrl = await resolveDirectTarget(cand.url);
    if (directUrl && !directUrl.includes("bloqueado") && !directUrl.includes("image2url")) {
      return {
        stream: cand,
        directUrl: directUrl
      };
    }
  }
  return null;
}

// Endpoint ponte residencial: o PC local resolve as streams do BestCine e entrega as URLs MP4 já prontas
app.get("/api/bridge/bestcine/:type/:id", async (req, res) => {
  const { type, id } = req.params;
  try {
    const bcUrl = `https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`;
    const bcRes = await axios.get(bcUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 3500
    });

    const rawStreams = bcRes.data?.streams || [];
    if (rawStreams.length === 0) return res.json({ s1080: null, s4k: null });

    const [best1080, best4k] = await Promise.all([
      selectResolvedBestCineStream(rawStreams, false),
      selectResolvedBestCineStream(rawStreams, true)
    ]);

    return res.json({ s1080: best1080, s4k: best4k });
  } catch (err) {
    return res.json({ s1080: null, s4k: null });
  }
});

// Busca no BestCine direto ou através da ponte residencial
async function getBestCineResolvedPair(type, id) {
  // 1. Tenta direto (se o processo estiver rodando em IP residencial ou com acesso)
  try {
    const bcUrl = `https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`;
    const bcRes = await axios.get(bcUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 2500
    });
    const rawStreams = bcRes.data?.streams || [];
    if (rawStreams.length > 0) {
      const [s1080, s4k] = await Promise.all([
        selectResolvedBestCineStream(rawStreams, false),
        selectResolvedBestCineStream(rawStreams, true)
      ]);
      if (s1080 || s4k) return { s1080, s4k };
    }
  } catch (e) {}

  // 2. Se falhar (ex: no Render), consulta a ponte residencial via túnel
  try {
    const bridgeUrl = `${TUNNEL_URL}/api/bridge/bestcine/${type}/${id}`;
    const bRes = await axios.get(bridgeUrl, { timeout: 4500 });
    if (bRes.data && (bRes.data.s1080 || bRes.data.s4k)) {
      return bRes.data;
    }
  } catch (e) {}

  return { s1080: null, s4k: null };
}

function parseSize(s) {
  const match = (s.title || "").match(/💾\s*([\d\.]+)\s*(GB|MB)/i);
  if (!match) return 999;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "MB" ? num / 1024 : num;
}

// Filtro rigoroso para confirmar DUBLAGEM BRASILEIRA autêntica no Torrentio
function isRealPtBr(s) {
  const fullText = `${s.name || ""} ${s.title || ""} ${s.behaviorHints?.filename || ""}`.toLowerCase();

  // 1. Elimina falso positivos de espanhol / latino
  if (/(spa-eng|eng-spa|spanish|espanol|castellano|latino|dual-lat|\.lat\.|argentina|mexico|cinecalidad)/i.test(fullText)) {
    return false;
  }

  // 2. Elimina Dual Audio onde os idiomas declarados são apenas ENG e outros (sem português)
  if (/\bdual\b/i.test(fullText) && /(🇬🇧.*🇪🇸|🇪🇸.*🇬🇧|🇬🇧.*🇵🇱|🇵🇱.*🇬🇧|eng.*spa|spa.*eng)/.test(fullText) && !/🇧🇷|pt-br|ptbr|dublado|portuguese/.test(fullText)) {
    return false;
  }

  // 3. Elimina conteúdo legendado ou apenas de Portugal (🇵🇹)
  if (fullText.includes("legendado") && !/(dublado|\bdual\b)/i.test(fullText)) {
    return false;
  }
  if (fullText.includes("🇵🇹") && !fullText.includes("🇧🇷") && !/(dublado|comando|bludv|micoleao|pt-br|ptbr)/i.test(fullText)) {
    return false;
  }

  // 4. Critérios válidos de Dublagem Brasileira
  const hasBrKeyword = /(dublado|comando|bludv|micoleao|pt-br|ptbr|\bnacional\b|dublagem)/i.test(fullText);
  const hasBrFlag = fullText.includes("🇧🇷");
  const isBrDual = /\bdual\b/i.test(fullText) && (fullText.includes("5.1") || fullText.includes("dublado") || /comando|bludv|besttorrents/.test(fullText));

  return hasBrKeyword || hasBrFlag || isBrDual;
}

function isCamQuality(s) {
  const text = `${s.name || ""} ${s.title || ""}`.toLowerCase();
  return /\b(camrip|telesync|hdcam|hdts)\b/i.test(text) || /\bcam\b/i.test(s.name || "");
}

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "21.0.0",
  name: "CineBR ⚡ Duas Opções Dubladas (1080p & 4K)",
  description: "Exatamente 2 opções: 1080p Projetor/Celular e 4K Smart TV. Áudio Dublado PT-BR garantido.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 21.0] Buscando streams para ${type} ID: ${id}`);
  let stream1080 = null;
  let stream4k = null;

  // =========================================================================
  // 1. TENTA PRIMEIRO NO BESTCINE (Fontes 100% Dubladas oficiais MP4 Direto)
  // =========================================================================
  try {
    const { s1080, s4k } = await getBestCineResolvedPair(type, id);

    if (s1080 && s1080.directUrl) {
      stream1080 = {
        name: "⚡ CineBR [1080p DUBLADO]",
        title: "🎬 1080p FULL HD • 🇧🇷 100% DUBLADO (BRASIL)\n⚡ Otimizado para Projetor e Celular (Zero Travamento)",
        url: s1080.directUrl,
        behaviorHints: { notWebReady: false }
      };
    }

    if (s4k && s4k.directUrl) {
      stream4k = {
        name: "💎 CineBR [4K DUBLADO]",
        title: "🎬 4K HDR ULTRA HD • 🇧🇷 100% DUBLADO (BRASIL)\n⚡ Máxima Definição para Smart TV",
        url: s4k.directUrl,
        behaviorHints: { notWebReady: false }
      };
    }
  } catch (err) {
    console.error("[CineBR 21.0] BestCine check err:", err.message);
  }

  // =========================================================================
  // 2. BUSCA NO ALLDEBRID: CANAL DEDICADO BR + CANAL GLOBAL
  // =========================================================================
  if (!stream1080 || !stream4k) {
    try {
      const [resBr, resGlobal] = await Promise.all([
        axios.get(`https://torrentio.strem.fun/providers=comando,bludv,micoleaodublado,besttorrents|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`, { timeout: 3500 }).catch(() => ({ data: {} })),
        axios.get(`https://torrentio.strem.fun/providers=torrent9,oxtorrent,cpasbien,yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`, { timeout: 3500 }).catch(() => ({ data: {} }))
      ]);

      const brStreams = resBr.data?.streams || [];
      const globalStreams = resGlobal.data?.streams || [];
      const rawStreams = [...brStreams, ...globalStreams];

      const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
      const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

      // --- 1080p: PRIORIZA DUBLADO BRASILEIRO REAL SE EXISTIR ---
      if (!stream1080) {
        const pt1080 = validStreams.filter((s) => isRealPtBr(s) && /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const anyPt = validStreams.filter((s) => isRealPtBr(s) && !isCamQuality(s));
        const any1080 = validStreams.filter((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const anyCam = validStreams.filter((s) => isCamQuality(s));

        const chosen1080 = pt1080[0] || anyPt.find((s) => parseSize(s) <= 8) || anyPt[0] || any1080.find((s) => parseSize(s) <= 8) || any1080[0] || anyCam[0];

        if (chosen1080) {
          const isDub = isRealPtBr(chosen1080);
          const isCam = isCamQuality(chosen1080);
          const qName = isCam ? "CINEMA CAM" : isDub ? "1080p DUBLADO" : "1080p ORIGINAL";
          const aName = isDub ? "🇧🇷 100% DUBLADO" : "🌐 ÁUDIO ORIGINAL / MULTI";

          stream1080 = {
            name: `⚡ CineBR [${qName}]`,
            title: `🎬 1080p • ${aName}\n⚡ ${chosen1080.title.split('\n')[0]}\n⚡ Otimizado para Projetor (Leve & Sem Travamentos)`,
            url: chosen1080.url,
            behaviorHints: chosen1080.behaviorHints || { notWebReady: false }
          };
        }
      }

      // --- 4K: EXCLUSIVAMENTE 4K SE EXISTIR ---
      if (!stream4k) {
        const pt4k = validStreams.filter((s) => isRealPtBr(s) && /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));
        const any4k = validStreams.filter((s) => /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`) && !isCamQuality(s));

        const chosen4k = pt4k[0] || any4k[0];
        if (chosen4k && chosen4k !== stream1080) {
          const isDub = isRealPtBr(chosen4k);
          const qName = isDub ? "4K DUBLADO" : "4K ORIGINAL";
          const aName = isDub ? "🇧🇷 100% DUBLADO" : "🌐 ÁUDIO ORIGINAL / MULTI";

          stream4k = {
            name: `💎 CineBR [${qName}]`,
            title: `🎬 4K UHD • ${aName}\n⚡ ${chosen4k.title.split('\n')[0]}\n⚡ Máxima Definição para Smart TV`,
            url: chosen4k.url,
            behaviorHints: chosen4k.behaviorHints || { notWebReady: false }
          };
        }
      }
    } catch (err) {
      console.error("[CineBR 21.0] AllDebrid error:", err.message);
    }
  }

  const finalStreams = [];
  if (stream1080) finalStreams.push(stream1080);
  if (stream4k) finalStreams.push(stream4k);

  return { streams: finalStreams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 21.0 Duas Opções Dubladas rodando na porta ${PORT}`);
});
