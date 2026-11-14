const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

// SEU TOKEN DO BESTCINE GERADO NA SUA CONTA
const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "6.0.0",
  name: "CineBR ⚡ BestCine & Frost Engine",
  description: "Streams HTTP diretos sem seeds, filmes e animes dublados em 4K e 1080p",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Resolvendo stream direto para ${type} ID: ${id}`);

  try {
    const res = await axios.get(
      `https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Referer": "https://bestcine.dpdns.org/"
        },
        timeout: 6000
      }
    );

    const streams = res.data?.streams || [];

    // Personaliza com o selo CineBR mantendo os servidores rápidos (Athena, Solaris, etc.)
    const cinebrStreams = streams.map(s => ({
      ...s,
      name: `CineBR ⚡ ${s.name || "Direto"}`,
      title: `⚡ [STREAM DIRETO • SEM SEEDS]\n${s.title || ""}`
    }));

    console.log(`[CineBR] Devolvendo ${cinebrStreams.length} streams diretos para ${id}`);
    return { streams: cinebrStreams };
  } catch (err) {
    console.error("[CineBR Error]:", err.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("CineBR 6.0 com motor BestCine ativo!");
