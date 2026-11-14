const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "10.0.0",
  name: "CineBR 🇧🇷 4K UHD & Dublados",
  description: "Filmes, séries e animes em 4K e 1080p instantâneo (Zero Seeds) com AllDebrid CDN e servidores diretos",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Resolvendo stream para ${type} ID: ${id}`);
  let streams = [];

  // MOTOR 1: BestCine (Servidores diretos MP4/HLS quando disponível)
  try {
    const res = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/"
      },
      timeout: 3000
    });

    if (res.data?.streams && res.data.streams.length > 0) {
      const bcStreams = res.data.streams.map(s => ({
        ...s,
        name: `CineBR ⚡ ${s.name?.replace(/\n/g, ' ') || 'Direto'}`,
        title: `🇧🇷 [100% DUBLADO • SERVIDOR DIRETO]\n${s.title || ''}`,
        behaviorHints: {
          ...(s.behaviorHints || {}),
          proxyHeaders: {
            request: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
              "Referer": "https://bestcine.dpdns.org/"
            }
          }
        }
      }));
      streams.push(...bcStreams);
    }
  } catch (err) {
    // BestCine inacessível ou bloqueado por datacenter - segue para o motor universal
  }

  // MOTOR 2: AllDebrid CDN Instantâneo Universal (Independente de FrostStream/BestCine)
  try {
    const providers = "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=20|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 6000 });
    const rawStreams = resAd.data?.streams || [];

    // Prioriza áudio dublado / dual / português
    const ptRegex = /(dublado|dual|dual audio|portugu|brazil|brasil|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\bpor\b)/i;
    const ptStreams = rawStreams.filter(s => ptRegex.test(`${s.name || ''} ${s.title || ''}`));
    const otherStreams = rawStreams.filter(s => !ptRegex.test(`${s.name || ''} ${s.title || ''}`));

    const mappedPt = ptStreams.map(s => {
      const is4k = /4k|2160p/i.test(`${s.name || ''} ${s.title || ''}`);
      return {
        ...s,
        name: is4k ? "CineBR ⚡ 4K UHD" : "CineBR ⚡ 1080p",
        title: `🇧🇷 [DUBLADO • ALLDEBRID INSTANT]\n${s.title}`
      };
    });

    const mappedOthers = otherStreams.slice(0, 6).map(s => {
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

  console.log(`[CineBR] Total de streams entregues para ${id}: ${streams.length}`);
  return { streams };
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`CineBR 10.0 rodando na porta ${PORT}`);
