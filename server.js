const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "7.0.0",
  name: "CineBR ⚡ Frost & BestCine Engine",
  description: "Filmes, séries e animes dublados PT-BR com reprodução direta HTTP sem seeds",
  resources: ["stream"],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Resolvendo stream para ${type} ID: ${id}`);

  try {
    const targetUrl = `https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`;
    const response = await axios({
      method: "get",
      url: targetUrl,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/",
        "Accept": "application/json"
      },
      timeout: 10000
    });

    const streams = response.data?.streams || [];
    console.log(`[CineBR] Sucesso! ${streams.length} streams encontrados para ${id}`);

    return {
      streams: streams.map(s => ({
        ...s,
        name: `CineBR ⚡ ${s.name?.replace(/\n/g, ' ') || 'Direto'}`,
        title: `🇧🇷 [100% DUBLADO • SEM SEEDS]\n${s.title || ''}`
      }))
    };
  } catch (error) {
    console.error("[CineBR] Erro ao buscar stream:", error.message);
    return { streams: [] };
  }
});

const PORT = process.env.PORT || 7000;
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`CineBR 7.0 rodando na porta ${PORT}`);
