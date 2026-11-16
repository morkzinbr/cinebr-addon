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

// Helper: segue redirecionamentos HTTP (301/302/307) para capturar a URL MP4 direta sem travar no bloqueado
function resolveFinalTarget(urlStr) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
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
            resolve(res.headers.location);
          } else {
            resolve(urlStr);
          }
        }
      );
      req.on("error", () => resolve(urlStr));
      req.setTimeout(3000, () => {
        req.destroy();
        resolve(urlStr);
      });
      req.end();
    } catch (e) {
      resolve(urlStr);
    }
  });
}

// Endpoint local de ponte residencial para o Render:
// Permite que a nuvem consulte o BestCine através do IP residencial brasileiro sem tomar 403
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
    return res.json(bcRes.data || { streams: [] });
  } catch (err) {
    return res.json({ streams: [] });
  }
});

// Função para buscar streams no BestCine:
// 1) Tenta direto (funciona no PC local)
// 2) Se estiver no Render e falhar (403), consulta através da ponte do túnel residencial
async function fetchBestCineStreams(type, id) {
  // 1. Tenta direto
  try {
    const bcUrl = `https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`;
    const res = await axios.get(bcUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        Referer: "https://bestcine.dpdns.org/"
      },
      timeout: 2500
    });
    if (res.data?.streams?.length > 0) {
      return res.data.streams;
    }
  } catch (e) {}

  // 2. Se falhou (ex: Render bloqueado por IP dos EUA), usa a ponte residencial via túnel
  try {
    const bridgeUrl = `${TUNNEL_URL}/api/bridge/bestcine/${type}/${id}`;
    const bridgeRes = await axios.get(bridgeUrl, { timeout: 3500 });
    if (bridgeRes.data?.streams?.length > 0) {
      return bridgeRes.data.streams;
    }
  } catch (e) {}

  return [];
}

// Seleciona servidor do BestCine garantindo link válido (Selene, Athena, Solaris, Safira unblocked)
async function getBestCineStream(streams, is4k) {
  const candidates = streams.filter((s) => {
    const qMatch = is4k ? /(4k|2160p|uhd)/i.test(s.name) : /(1080p|fhd)/i.test(s.name);
    return s.url && qMatch;
  });

  // Prioriza servidores mais rápidos e estáveis
  candidates.sort((a, b) => {
    const p = (s) => (s.title?.includes("Selene") ? 1 : s.title?.includes("Athena") ? 2 : s.title?.includes("Safira") ? 3 : 4);
    return p(a) - p(b);
  });

  for (const cand of candidates) {
    const target = await resolveFinalTarget(cand.url);
    if (!target.includes("bloqueado")) {
      return { stream: cand, url: target };
    }
  }
  return null;
}

function parseSize(s) {
  const match = (s.title || "").match(/💾\s*([\d\.]+)\s*(GB|MB)/i);
  if (!match) return 999;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "MB" ? num / 1024 : num;
}

// Filtro ultra rigoroso para confirmar DUBLAGEM BRASILEIRA autêntica no Torrentio
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
  version: "20.0.0",
  name: "CineBR ⚡ Duas Opções Dubladas (1080p & 4K)",
  description: "Exatamente 2 opções: 1080p Projetor/Celular e 4K Smart TV. Áudio Dublado PT-BR garantido.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 20.0] Buscando streams para ${type} ID: ${id}`);
  let stream1080 = null;
  let stream4k = null;

  // =========================================================================
  // 1. TENTA PRIMEIRO NO BESTCINE (Fontes 100% Dubladas oficiais MP4 Direto)
  // =========================================================================
  try {
    const bcStreams = await fetchBestCineStreams(type, id);
    if (bcStreams.length > 0) {
      const best1080 = await getBestCineStream(bcStreams, false);
      const best4k = await getBestCineStream(bcStreams, true);

      if (best1080) {
        stream1080 = {
          name: "⚡ CineBR [1080p DUBLADO]",
          title: "🎬 1080p FULL HD • 🇧🇷 100% DUBLADO (BRASIL)\n⚡ Otimizado para Projetor e Celular (Zero Travamento)",
          url: best1080.url,
          behaviorHints: { notWebReady: false }
        };
      }

      if (best4k) {
        stream4k = {
          name: "💎 CineBR [4K DUBLADO]",
          title: "🎬 4K HDR ULTRA HD • 🇧🇷 100% DUBLADO (BRASIL)\n⚡ Máxima Definição para Smart TV",
          url: best4k.url,
          behaviorHints: { notWebReady: false }
        };
      }
    }
  } catch (err) {
    console.error("[CineBR 20.0] BestCine check err:", err.message);
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
      console.error("[CineBR 20.0] AllDebrid error:", err.message);
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
  console.log(`CineBR 20.0 Duas Opções Dubladas rodando na porta ${PORT}`);
});
