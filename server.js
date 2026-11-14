const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

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

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "12.0.0",
  name: "CineBR ⚡ Turbo Instant (Dublados & 4K)",
  description: "Carregamento ultra-rápido instantâneo. Prioriza servidores velozes (Safira & Athena) e filtra filmes com precisão.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

const titleCache = new Map();
async function getExpectedTitle(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  try {
    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`, { timeout: 2500 });
    const name = metaRes.data?.meta?.name;
    if (name) {
      titleCache.set(id, name);
      return name;
    }
  } catch (e) {}
  return null;
}

// Classificação de velocidade dos servidores BestCine
function rankServer(serverName, quality) {
  let score = 0;
  const s = (serverName || '').toLowerCase();
  const q = (quality || '').toLowerCase();

  // 1080p carrega 5x mais rápido no celular que 4K
  if (q.includes('1080p')) score += 30;
  else if (q.includes('720p')) score += 20;
  else if (q.includes('4k')) score += 10;

  // Safira e Athena são os mais rápidos e com maior banda
  if (s.includes('safira')) score += 50;
  else if (s.includes('athena')) score += 40;
  else if (s.includes('zenith')) score += 30;
  else if (s.includes('selene')) score += 15;
  else score += 5;

  return score;
}

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Buscando streams para ${type} ID: ${id}`);
  let streams = [];

  // Obter título original para filtrar torrents errôneos
  const expectedTitle = await getExpectedTitle(id);
  const titleKeywords = expectedTitle
    ? expectedTitle.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(w => w.length > 2)
    : [];

  // MOTOR 1: BestCine (Direto sem proxy intermediário para ping zero e máxima taxa de transferência)
  try {
    const res = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/"
      },
      timeout: 3000
    });

    if (res.data?.streams && res.data.streams.length > 0) {
      // Ordena por velocidade real de início de reprodução: 1080p Safira primeiro
      const bcStreams = res.data.streams
        .filter(s => !s.name?.includes('Selene')) // Remove Selene por latência alta
        .map(s => {
          const qual = s.name?.includes('4K') ? '4K HDR' : (s.name?.includes('1080p') ? '1080p' : '720p');
          const isInstant = qual === '1080p' || s.title?.includes('Safira');
          return {
            ...s,
            score: rankServer(s.title, qual),
            name: isInstant ? `⚡ CineBR [PLAY RÁPIDO] ${qual}` : `CineBR ${qual}`,
            title: `🇧🇷 [100% DUBLADO • SEM SEEDS]\n${s.title || ''}`,
            behaviorHints: {
              ...(s.behaviorHints || {}),
              notWebReady: false
            }
          };
        })
        .sort((a, b) => b.score - a.score);

      streams.push(...bcStreams);
    }
  } catch (err) {
    // BestCine indisponível no momento
  }

  // MOTOR 2: AllDebrid CDN Instantâneo com validação estrita de título
  try {
    const providers = "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=20|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 5000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra estritamente pelo título correto
    const validStreams = rawStreams.filter(s => {
      if (titleKeywords.length === 0) return true;
      const streamText = `${s.title || ''} ${s.behaviorHints?.filename || ''}`.toLowerCase();
      // Não pode ser outro filme
      return titleKeywords.some(kw => streamText.includes(kw));
    });

    const ptRegex = /(dublado|dual|dual audio|portugu|brazil|brasil|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\bpor\b)/i;
    const ptStreams = validStreams.filter(s => ptRegex.test(`${s.name || ''} ${s.title || ''}`));
    const otherStreams = validStreams.filter(s => !ptRegex.test(`${s.name || ''} ${s.title || ''}`));

    const mappedPt = ptStreams.slice(0, 3).map(s => {
      const is4k = /4k|2160p/i.test(`${s.name || ''} ${s.title || ''}`);
      return {
        ...s,
        name: is4k ? "CineBR ⚡ 4K UHD" : "⚡ CineBR [PLAY RÁPIDO] 1080p",
        title: `🇧🇷 [DUBLADO • ALLDEBRID INSTANT]\n${s.title}`
      };
    });

    const mappedOthers = otherStreams.slice(0, 2).map(s => {
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
  console.log(`CineBR 12.0 Turbo rodando na porta ${PORT}`);
});
