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
  version: "16.0.0",
  name: "CineBR ⚡ Play Único",
  description: "Apenas 1 opção inteligente: seleciona e entrega automaticamente o melhor servidor.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 16.0] Buscando o melhor stream único para ${type} ID: ${id}`);

  try {
    const providers =
      "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 4000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra animações e coleções intrusas
    const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
    const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

    function isCamQuality(stream) {
      const fullText = `${stream.name || ""} ${stream.title || ""}`.toLowerCase();
      return (
        /\b(camrip|telesync|hdcam|hdts)\b/i.test(fullText) ||
        /\bcam\b/i.test(stream.name || "")
      );
    }

    function isDubbed(stream) {
      const fullText = `${stream.name || ""} ${stream.title || ""}`;
      return /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(fullText);
    }

    const dubbedHd = validStreams.filter((s) => isDubbed(s) && !isCamQuality(s));
    const originalHd = validStreams.filter((s) => !isDubbed(s) && !isCamQuality(s));
    const dubbedCam = validStreams.filter((s) => isDubbed(s) && isCamQuality(s));
    const anyCam = validStreams.filter((s) => isCamQuality(s));

    // Define o pool na ordem de prioridade
    let pool = [];
    if (dubbedHd.length > 0) {
      pool = dubbedHd;
    } else if (originalHd.length > 0) {
      pool = originalHd;
    } else if (dubbedCam.length > 0) {
      pool = dubbedCam;
    } else {
      pool = anyCam;
    }

    if (pool.length > 0) {
      // Dentre as opções da melhor categoria, escolhe a versão perfeita:
      // Prefere arquivos otimizados (3GB a 12GB) para iniciar em 0.5s sem travar
      const optimal = pool.filter((s) => parseSize(s) >= 2 && parseSize(s) <= 15);
      const best = optimal[0] || pool[0];

      const is4k = /(4k|2160p|uhd)/i.test(`${best.name || ""} ${best.title || ""}`);
      const isDub = isDubbed(best);
      const isCam = isCamQuality(best);

      let qualityBadge = is4k ? "4K UHD" : "1080p FULL HD";
      if (isCam) qualityBadge = "CINEMA CAM";

      const audioBadge = isDub ? "🇧🇷 100% DUBLADO" : "🌐 ORIGINAL / LEGENDADO";

      // RETORNA RIGOROSAMENTE APENAS 1 OPÇÃO ÚNICA!
      return {
        streams: [
          {
            name: `⚡ CineBR [${qualityBadge}]`,
            title: `🎬 REPRODUÇÃO DIRETA • ${qualityBadge}\n${audioBadge} • ALLDEBRID INSTANT\n⚡ ${best.title.split('\n')[0]}`,
            url: best.url,
            behaviorHints: best.behaviorHints || { notWebReady: false }
          }
        ]
      };
    }
  } catch (err) {
    console.error("[CineBR 16.0] Erro:", err.message);
  }

  return { streams: [] };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 16.0 Play Único rodando na porta ${PORT}`);
});
