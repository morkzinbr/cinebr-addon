const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

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
  version: "15.1.0",
  name: "CineBR ⚡ Full (Dublados & Cinema)",
  description: "Filmes oficiais em HD/4K Dublados e lançamentos recentes de cinema via AllDebrid.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 15.1] Buscando streams para ${type} ID: ${id}`);

  try {
    const providers =
      "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    // Sem filtrar CAM para garantir que filmes recém-saídos do cinema (ex: Whalefall, Godzilla) apareçam!
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 4000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra animações e coleções intrusas
    const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
    const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

    // Separa streams dublados
    const ptStreams = validStreams.filter((s) =>
      /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`)
    );

    // Se tiver dublado, usa dublado. Se for filme novo que só tem versão de cinema/original, usa o melhor disponível!
    const pool = ptStreams.length > 0 ? ptStreams : validStreams;

    const resultStreams = pool.slice(0, 5).map((s) => {
      const is4k = /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`);
      const isDub = /(dublado|dual|pt-br|ptbr|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`);
      const isCam = /(cam|telesync|ts|hdcam)/i.test(`${s.name || ""} ${s.title || ""}`);

      let qualityTag = is4k ? "4K UHD" : "1080p FULL HD";
      if (isCam) qualityTag = "CINEMA CAM";

      const badge = isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL / LEGENDADO";

      return {
        name: `⚡ CineBR [${qualityTag}]`,
        title: `🎬 ${s.title.split('\n')[0]}\n${badge} • REPRODUÇÃO DIRETA\n⚡ ${s.title.split('\n')[1] || ''}`,
        url: s.url,
        behaviorHints: s.behaviorHints || { notWebReady: false }
      };
    });

    if (resultStreams.length > 0) {
      return { streams: resultStreams };
    }
  } catch (err) {
    console.error("[CineBR 15.1] Erro:", err.message);
  }

  return { streams: [] };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 15.1 Full rodando na porta ${PORT}`);
});
