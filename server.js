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

function parseSize(s) {
  const match = (s.title || "").match(/💾\s*([\d\.]+)\s*(GB|MB)/i);
  if (!match) return 999;
  const num = parseFloat(match[1]);
  return match[2].toUpperCase() === "MB" ? num / 1024 : num;
}

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "15.0.0",
  name: "CineBR ⚡ Direto (Dublado & 4K)",
  description: "Links Diretos do AllDebrid na Nuvem sem intermediários. Abre na hora!",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 15.0] Buscando streams diretos para ${type} ID: ${id}`);

  try {
    const providers =
      "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 4000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra animações intrusas e pacotes velhos
    const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
    const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

    // Filtra streams dublados / nacionais
    const ptStreams = validStreams.filter((s) =>
      /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`)
    );

    const pool = ptStreams.length > 0 ? ptStreams : validStreams;

    // Converte e entrega os streams diretamente COM A URL FINAL NATIVA
    const resultStreams = pool.slice(0, 4).map((s, idx) => {
      const is4k = /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`);
      const isDub = /(dublado|dual|pt-br|ptbr|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`);
      
      const badge = isDub ? "🇧🇷 DUBLADO" : "🌐 ORIGINAL / MULTI";
      const qualityTag = is4k ? "4K UHD" : "1080p FULL HD";

      return {
        name: `⚡ CineBR [${qualityTag}]`,
        title: `🎬 ${s.title.split('\n')[0]}\n${badge} • ALLDEBRID INSTANT\n⚡ ${s.title.split('\n')[1] || ''}`,
        url: s.url,
        behaviorHints: s.behaviorHints || { notWebReady: false }
      };
    });

    if (resultStreams.length > 0) {
      return { streams: resultStreams };
    }
  } catch (err) {
    console.error("[CineBR 15.0] Erro:", err.message);
  }

  return { streams: [] };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 15.0 Direto rodando na porta ${PORT}`);
});
