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
  version: "15.2.0",
  name: "CineBR ⚡ Full (Dublados & Cinema)",
  description: "Prioridade Absoluta Dublado HD/4K com Fallback Inteligente para Lançamentos de Cinema.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR 15.2] Buscando streams para ${type} ID: ${id}`);

  try {
    const providers =
      "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 4000 });
    const rawStreams = resAd.data?.streams || [];

    // Filtra animações intrusas e pacotes velhos (ex: Coleção Batman 1993-2013)
    const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
    const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

    // Detecta se é gravação de cinema real
    function isCamQuality(stream) {
      const fullText = `${stream.name || ""} ${stream.title || ""}`.toLowerCase();
      // Não confunda .cam. ou .camrip. com palavras normais ou tags bluray
      return (
        /\b(camrip|telesync|hdcam|hdts)\b/i.test(fullText) ||
        /\bcam\b/i.test(stream.name || "")
      );
    }

    // Detecta se é Dublado / PT-BR
    function isDubbed(stream) {
      const fullText = `${stream.name || ""} ${stream.title || ""}`;
      return /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(fullText);
    }

    // Separa categorias
    const dubbedHd = validStreams.filter((s) => isDubbed(s) && !isCamQuality(s));
    const originalHd = validStreams.filter((s) => !isDubbed(s) && !isCamQuality(s));
    const dubbedCam = validStreams.filter((s) => isDubbed(s) && isCamQuality(s));
    const anyCam = validStreams.filter((s) => isCamQuality(s));

    // REGRAS DE PRIORIDADE (TUDO EM UM):
    // 1º Prioridade: Dublados em Alta Definição (1080p / 4K / Blu-Ray)
    // 2º Se não tiver dublado, entrega HD Original / Legendado
    // 3º Se não tiver versão digital (filme em cartaz), vai para gravação de cinema CAM
    let selectedPool = [];

    if (dubbedHd.length > 0) {
      selectedPool = dubbedHd;
    } else if (originalHd.length > 0) {
      selectedPool = originalHd;
    } else if (dubbedCam.length > 0) {
      selectedPool = dubbedCam;
    } else {
      selectedPool = anyCam;
    }

    const resultStreams = selectedPool.slice(0, 4).map((s) => {
      const is4k = /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`);
      const isDub = isDubbed(s);
      const isCam = isCamQuality(s);

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
    console.error("[CineBR 15.2] Erro:", err.message);
  }

  return { streams: [] };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 15.2 Full rodando na porta ${PORT}`);
});
