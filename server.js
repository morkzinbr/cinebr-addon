const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "3.0.0",
  name: "CineBR ⚡ 4K UHD AllDebrid",
  description: "Filmes, Séries e Animes em 4K HDR e Dual Áudio PT-BR via AllDebrid Instantâneo",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

// Manipulador de Streams que puxa e filtra as fontes reais do AllDebrid
builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Buscando streams reais para ${type} ID: ${id}`);

  try {
    // Consulta o motor do Torrentio + AllDebrid diretamente com a sua chave
    const res = await axios.get(
      `https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado|sort=qualitysize|qualityfilter=scr,cam|limit=15|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`,
      { timeout: 7000 }
    );

    const streams = res.data?.streams || [];

    // Personaliza as tags e organiza para o usuário com selo CineBR
    const customizedStreams = streams.map(s => {
      let badge = "CineBR ⚡ [AD+]";
      if (s.name && s.name.includes("4k")) {
        badge = "CineBR ⚡ 4K UHD";
      } else if (s.name && s.name.includes("1080p")) {
        badge = "CineBR ⚡ 1080p";
      }

      return {
        ...s,
        name: badge
      };
    });

    console.log(`[CineBR] Entregando ${customizedStreams.length} streams reais para ${id}`);
    return { streams: customizedStreams };
  } catch (err) {
    console.error("[CineBR Error]:", err.message);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: process.env.PORT || 7000 });
console.log("CineBR 3.0 Real Streams ativo!");
