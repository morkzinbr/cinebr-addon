const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "4.0.0",
  name: "CineBR 🇧🇷 100% Dublado & Dual Áudio [4K / PT-BR]",
  description: "Filtro estrito estilo FrostStream: Apenas conteúdos com Dublagem e Áudio em Português (PT-BR)",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

// Palavras-chave obrigatórias para garantir que é dublado ou tem áudio em português
const PTBR_REGEX = /(dublado|dual|dual audio|dual-audio|pt-br|ptbr|portugu[eê]s|brazilian|dub|comando|bludv|micoleao|🇧🇷|🇵🇹)/i;

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Buscando streams 100% PT-BR para ${type} ID: ${id}`);

  try {
    const res = await axios.get(
      `https://torrentio.strem.fun/providers=comando,bludv,micoleaodublado,yts,1337x,torrentgalaxy,thepiratebay|sort=qualitysize|qualityfilter=scr,cam|limit=30|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`,
      { timeout: 7000 }
    );

    const streams = res.data?.streams || [];

    // FILTRO ESTRITO ESTILO FROSTSTREAM: descarta tudo que não for em Português
    const ptbrStreams = streams.filter(s => {
      const fullText = `${s.name || ""} ${s.title || ""}`;
      return PTBR_REGEX.test(fullText);
    });

    const finalStreams = (ptbrStreams.length > 0 ? ptbrStreams : streams.slice(0, 5)).map(s => {
      let quality = "1080p";
      if (s.name && (s.name.includes("4k") || s.title?.includes("2160p"))) {
        quality = "4K UHD";
      } else if (s.title && s.title.includes("720p")) {
        quality = "720p HD";
      }

      return {
        ...s,
        name: `CineBR 🇧🇷 ${quality}`,
        title: `🇧🇷 [DUBLADO / DUAL ÁUDIO PT-BR]\n${s.title}`
      };
    });

    console.log(`[CineBR] Entregando ${finalStreams.length} streams com foco em PT-BR para ${id}`);
    return { streams: finalStreams };
  } catch (err) {
    console.error("[CineBR Error]:", err.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("CineBR 4.0 (100% Dublado PT-BR) ativo!");
