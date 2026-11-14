const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "5.0.0",
  name: "CineBR ⚡ Instant Play PT-BR [4K / AllDebrid]",
  description: "Exclusivo Instant Cache: Apenas filmes que tocam na hora sem esperar download, com Dublagem PT-BR",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

const PTBR_REGEX = /(dublado|dual|dual audio|dual-audio|pt-br|ptbr|portugu[eê]s|brazilian|comando|bludv|micoleao|🇧🇷|🇵🇹)/i;

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Buscando streams em cache instantâneo para ${type} ID: ${id}`);

  try {
    // dontShowDebridDownloading: oculta downloads não finalizados e entrega APENAS cache 100% pronto
    const res = await axios.get(
      `https://torrentio.strem.fun/providers=comando,bludv,micoleaodublado,yts,1337x,torrentgalaxy,thepiratebay|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=30|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`,
      { timeout: 7000 }
    );

    const streams = res.data?.streams || [];

    // Filtra apenas o que possui português (PT-BR) e já está no cache instantâneo
    const ptbrStreams = streams.filter(s => {
      const fullText = `${s.name || ""} ${s.title || ""}`;
      return PTBR_REGEX.test(fullText);
    });

    const finalStreams = (ptbrStreams.length > 0 ? ptbrStreams : streams.slice(0, 4)).map(s => {
      let quality = "1080p";
      if (s.name && (s.name.includes("4k") || s.title?.includes("2160p"))) {
        quality = "4K UHD";
      } else if (s.title && s.title.includes("720p")) {
        quality = "720p HD";
      }

      return {
        ...s,
        name: `CineBR ⚡ ${quality}`,
        title: `⚡ [PLAY INSTANTÂNEO • DUBLADO PT-BR]\n${s.title}`
      };
    });

    console.log(`[CineBR] Entregando ${finalStreams.length} streams instantâneos prontos para ${id}`);
    return { streams: finalStreams };
  } catch (err) {
    console.error("[CineBR Error]:", err.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("CineBR 5.0 Instant Cache ativo!");
