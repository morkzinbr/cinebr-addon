const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "8.0.0",
  name: "CineBR 🇧🇷 4K UHD & Dublados",
  description: "Filmes, séries e animes dublados PT-BR com reprodução instantânea",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Resolvendo stream para ${type} ID: ${id}`);
  let streams = [];

  // 1. Tenta buscar no motor do BestCine (HTTP Direto sem seeds)
  try {
    const res = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/"
      },
      timeout: 5000
    });

    if (res.data?.streams && res.data.streams.length > 0) {
      streams = res.data.streams.map(s => ({
        ...s,
        name: `CineBR ⚡ ${s.name?.replace(/\n/g, ' ') || 'Direto'}`,
        title: `🇧🇷 [DUBLADO • PLAY INSTANTÂNEO]\n${s.title || ''}`
      }));
    }
  } catch (err) {
    console.error("[CineBR] Falha na fonte primária:", err.message);
  }

  // 2. Se a fonte primária não responder ou estiver bloqueada no datacenter, usa AllDebrid Instant Cache
  if (streams.length === 0) {
    try {
      const resAd = await axios.get(
        `https://torrentio.strem.fun/providers=comando,bludv,micoleaodublado,yts,1337x,torrentgalaxy,thepiratebay|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=10|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`,
        { timeout: 5000 }
      );

      const adStreams = resAd.data?.streams || [];
      const ptbrAd = adStreams.filter(s => /(dublado|dual|dual audio|pt-br|ptbr|portugu|comando|bludv|micoleao|🇧🇷|🇵🇹)/i.test(`${s.name || ''} ${s.title || ''}`));

      streams = (ptbrAd.length > 0 ? ptbrAd : adStreams.slice(0, 3)).map(s => ({
        ...s,
        name: s.name?.includes('4k') ? 'CineBR ⚡ 4K UHD' : 'CineBR ⚡ 1080p',
        title: `🇧🇷 [DUBLADO • CACHE ALLDEBRID]\n${s.title}`
      }));
    } catch (errAd) {
      console.error("[CineBR] Falha no fallback:", errAd.message);
    }
  }

  console.log(`[CineBR] Retornando ${streams.length} opções para ${id}`);
  return { streams };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`CineBR 8.0 rodando na porta ${PORT}`);
