const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const app = express();

// Middleware CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// PROXY DE VÍDEO UNIVERSAL
// Repassa o tráfego do BestCine para qualquer dispositivo ou rede (casa ou fora)
// injetando os cabeçalhos de navegador e evitando bloqueio de hotlinking/403
app.get("/proxy/stream", async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send("Missing url param");

  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "Referer": "https://bestcine.dpdns.org/"
    };

    if (req.headers.range) {
      headers["Range"] = req.headers.range;
    }

    const response = await axios({
      method: req.method,
      url: targetUrl,
      headers: headers,
      responseType: "stream",
      validateStatus: () => true,
      timeout: 15000
    });

    const forwardHeaders = ["content-type", "content-length", "content-range", "accept-ranges"];
    forwardHeaders.forEach(h => {
      if (response.headers[h]) {
        res.setHeader(h, response.headers[h]);
      }
    });

    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    console.error("[CineBR Proxy] Erro ao transmitir vídeo:", err.message);
    if (!res.headersSent) res.status(502).send("Bad Gateway");
  }
});

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "11.0.0",
  name: "CineBR 🇧🇷 4K UHD & Dublados",
  description: "Filmes, séries e animes dublados PT-BR e 4K HDR instantâneo (Zero Seeds) com BestCine Engine e AllDebrid CDN",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

// Cache auxiliar de metadados para validação estrita de título
const titleCache = new Map();
async function getExpectedTitle(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  try {
    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`, { timeout: 3000 });
    const name = metaRes.data?.meta?.name;
    if (name) {
      titleCache.set(id, name);
      return name;
    }
  } catch (e) {}
  return null;
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Buscando streams para ${type} ID: ${id}`);
  let streams = [];

  // Obter título original para filtrar torrents errôneos
  const expectedTitle = await getExpectedTitle(id);
  const titleKeywords = expectedTitle
    ? expectedTitle.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2)
    : [];

  // MOTOR 1: BestCine (Servidores diretos MP4/HLS)
  try {
    const res = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/"
      },
      timeout: 3500
    });

    if (res.data?.streams && res.data.streams.length > 0) {
      const bcStreams = res.data.streams.map(s => {
        // Envelopa a URL no Proxy para reprodução garantida em qualquer player/rede
        const proxiedUrl = `https://cinebr-addon.onrender.com/proxy/stream?url=${encodeURIComponent(s.url)}`;
        return {
          ...s,
          name: `CineBR ⚡ ${s.name?.replace(/\n/g, ' ') || 'Direto'}`,
          title: `🇧🇷 [100% DUBLADO • SEM SEEDS]\n${s.title || ''}`,
          url: proxiedUrl,
          behaviorHints: {
            ...(s.behaviorHints || {}),
            notWebReady: false
          }
        };
      });
      streams.push(...bcStreams);
    }
  } catch (err) {
    // BestCine indisponível no momento
  }

  // MOTOR 2: AllDebrid CDN Instantâneo (Filtrado estritamente por título)
  try {
    const providers = "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=25|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 6000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra para garantir que o arquivo corresponde REALMENTE ao título pedido (evita filmes aleatórios)
    const validStreams = rawStreams.filter(s => {
      if (titleKeywords.length === 0) return true;
      const streamText = `${s.title || ''} ${s.behaviorHints?.filename || ''}`.toLowerCase();
      return titleKeywords.some(kw => streamText.includes(kw));
    });

    // Prioriza áudio dublado / dual / português
    const ptRegex = /(dublado|dual|dual audio|portugu|brazil|brasil|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\bpor\b)/i;
    const ptStreams = validStreams.filter(s => ptRegex.test(`${s.name || ''} ${s.title || ''}`));
    const otherStreams = validStreams.filter(s => !ptRegex.test(`${s.name || ''} ${s.title || ''}`));

    const mappedPt = ptStreams.map(s => {
      const is4k = /4k|2160p/i.test(`${s.name || ''} ${s.title || ''}`);
      return {
        ...s,
        name: is4k ? "CineBR ⚡ 4K UHD" : "CineBR ⚡ 1080p",
        title: `🇧🇷 [DUBLADO • ALLDEBRID INSTANT]\n${s.title}`
      };
    });

    const mappedOthers = otherStreams.slice(0, 4).map(s => {
      const is4k = /4k|2160p/i.test(`${s.name || ''} ${s.title || ''}`);
      return {
        ...s,
        name: is4k ? "CineBR ⚡ 4K Original" : "CineBR ⚡ 1080p Original",
        title: `🌐 [ORIGINAL/MULTILANG • ALLDEBRID INSTANT]\n${s.title}`
      };
    });

    streams.push(...mappedPt, ...mappedOthers);
  } catch (errAd) {
    console.error("[CineBR] Falha na CDN AllDebrid:", errAd.message);
  }

  console.log(`[CineBR] Entregando ${streams.length} opções validadas para ${id}`);
  return { streams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 11.0 rodando na porta ${PORT}`);
});
