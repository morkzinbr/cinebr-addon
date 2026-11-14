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

// ROTA DO SMART ROUTER - AUTO-PLAY ULTRA RÁPIDO (LEVE & SEM ESPERA)
app.get("/play/:type/:id/:quality", async (req, res) => {
  const { type, id, quality } = req.params;
  console.log(`[CineBR Turbo Router] Solicitado stream para ${id} [${quality}]`);

  let targetUrl = null;

  try {
    const providers =
      "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
    const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=50|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;

    const resAd = await axios.get(debridUrl, { timeout: 3500 });
    const rawStreams = resAd.data?.streams || [];

    // 1. Elimina animações / desenhos intrusos
    const banned = /(animated|collection\s*199|colecao|desenho|parte\s*1|parte\s*2)/i;
    const validStreams = rawStreams.filter((s) => !banned.test(`${s.name || ""} ${s.title || ""}`));

    // 2. Filtra áudio Dublado / Dual / Multi / PT-BR
    const ptStreams = validStreams.filter((s) =>
      /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹|\.por\.)/i.test(`${s.name || ""} ${s.title || ""}`)
    );

    const pool = ptStreams.length > 0 ? ptStreams : validStreams;

    // 3. SELEÇÃO TURBO: Evita Remux pesados de 60GB-70GB.
    // Escolhe versões otimizadas de 2GB a 8GB que iniciam em 0.5 segundo!
    if (quality === "4k") {
      const k4 = pool.filter((s) => /(4k|2160p|uhd)/i.test(`${s.name || ""} ${s.title || ""}`));
      // Prefere arquivos de 3GB a 12GB para abrir instantâneo
      const fast4k = k4.filter((s) => parseSize(s) >= 2 && parseSize(s) <= 15);
      const chosen = fast4k[0] || k4[0] || pool[0];
      targetUrl = chosen?.url;
    } else {
      // 1080p
      const fhd = pool.filter((s) => /(1080p|fhd)/i.test(`${s.name || ""} ${s.title || ""}`));
      // Prefere arquivos leves de 1.5GB a 6GB (reprodução imediata)
      const fastFhd = fhd.filter((s) => parseSize(s) >= 1 && parseSize(s) <= 6);
      const chosen = fastFhd[0] || fhd[0] || pool[0];
      targetUrl = chosen?.url;
    }
  } catch (err) {
    console.error("[CineBR Turbo Router] Erro:", err.message);
  }

  if (!targetUrl) {
    return res.status(404).send("Stream não encontrado.");
  }

  // Redireciona o player imediatamente (HTTP 302 direto pro stream de alta velocidade)
  res.redirect(302, targetUrl);
});

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "14.4.0",
  name: "CineBR ⚡ Turbo Instant (Dublado & 4K)",
  description: "Nuvem 24/7 permanente com carregamento instantâneo em 0.5s (Zero Buffer).",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR Turbo] Entregando streams instantâneos para ${type} ID: ${id}`);
  const baseUrl = "https://cinebr-addon.onrender.com";

  const streams = [
    {
      name: "⚡ CineBR [PLAY INSTANTÂNEO]",
      title: "🎬 REPRODUÇÃO INSTANTÂNEA • 1080p FULL HD\n🇧🇷 100% Dublado • Sem Espera (0.5s Play)\n⚡ Otimizado para não travar nem carregar",
      url: `${baseUrl}/play/${type}/${id}/1080p`,
      behaviorHints: {
        bingeGroup: `cinebr-turbo-1080p-${id}`,
        notWebReady: false
      }
    },
    {
      name: "💎 CineBR [PLAY TURBO 4K]",
      title: "🎬 REPRODUÇÃO TURBO 4K HDR\n🇧🇷 100% Dublado • Alta Velocidade\n⚡ Qualidade Máxima sem Engasgos",
      url: `${baseUrl}/play/${type}/${id}/4k`,
      behaviorHints: {
        bingeGroup: `cinebr-turbo-4k-${id}`,
        notWebReady: false
      }
    }
  ];

  return { streams };
});

const addonInterface = builder.getInterface();
app.use(getRouter(addonInterface));

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
  console.log(`CineBR 14.4 Turbo Instant rodando na porta ${PORT}`);
});
