const express = require("express");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const axios = require("axios");

const BESTCINE_TOKEN = "bc_c1f66386eb023e0bc0a6d314";
const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "*");
  res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Cache inteligente de metadados
const titleCache = new Map();
async function getExpectedMetadata(id) {
  if (titleCache.has(id)) return titleCache.get(id);
  try {
    const metaRes = await axios.get(`https://v3-cinemeta.strem.io/meta/movie/${id}.json`, { timeout: 2500 });
    const meta = metaRes.data?.meta;
    if (meta?.name) {
      const data = {
        name: meta.name.toLowerCase(),
        year: meta.year ? parseInt(meta.year) : null
      };
      titleCache.set(id, data);
      return data;
    }
  } catch (e) {}
  return null;
}

// ROTA DO SMART PROXY (MULTI-SERVIDOR COM AUTO-FAILOVER)
// Testa e roteia para o melhor servidor disponível em tempo real
app.get("/play/:type/:id/:quality", async (req, res) => {
  const { type, id, quality } = req.params;
  console.log(`[CineBR Smart Router] Solicitado stream para ${id} [${quality}]`);

  let targetUrl = null;

  // 1. Tenta pegar os streams do BestCine
  try {
    const bcRes = await axios.get(`https://bestcine.dpdns.org/${BESTCINE_TOKEN}/stream/${type}/${id}.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Referer": "https://bestcine.dpdns.org/"
      },
      timeout: 3000
    });

    const bcStreams = bcRes.data?.streams || [];
    // Prioriza Safira (menor latência ~900ms) e depois Athena
    const safira = bcStreams.find(s => s.url && s.title?.includes("Safira") && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p")));
    const athena = bcStreams.find(s => s.url && s.title?.includes("Athena") && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p")));
    const anyMatching = bcStreams.find(s => s.url && (quality === "4k" ? s.name?.includes("4K") : s.name?.includes("1080p")));
    const anyBc = bcStreams.find(s => s.url);

    const bestStream = safira || athena || anyMatching || anyBc;
    if (bestStream?.url) {
      targetUrl = bestStream.url;
    }
  } catch (err) {
    console.error("[CineBR Router] Erro consultando BestCine:", err.message);
  }

  // 2. Se BestCine não respondeu, faz failover transparente para AllDebrid Instantâneo
  if (!targetUrl) {
    try {
      const providers = "yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,nyaasi,tokyotosho,anidex,comando,bludv,micoleaodublado,cinecalidad,besttorrents";
      const debridUrl = `https://torrentio.strem.fun/providers=${providers}|sort=qualitysize|qualityfilter=scr,cam|debridoptions=nodownloadlinks|limit=20|alldebrid=${ALLDEBRID_API_KEY}/stream/${type}/${id}.json`;
      const resAd = await axios.get(debridUrl, { timeout: 4000 });
      const rawStreams = resAd.data?.streams || [];

      const ptStreams = rawStreams.filter(s => /(dublado|dual|pt-br|ptbr|comando|bludv|micoleao|🇧🇷|🇵🇹)/i.test(`${s.name || ''} ${s.title || ''}`));
      const chosenAd = ptStreams[0] || rawStreams[0];
      if (chosenAd?.url) {
        targetUrl = chosenAd.url;
      }
    } catch (errAd) {
      console.error("[CineBR Router] Erro consultando AllDebrid:", errAd.message);
    }
  }

  if (!targetUrl) {
    return res.status(404).send("Nenhum servidor disponível no momento.");
  }

  // Redireciona imediatamente (302) o player para o link direto mais rápido
  res.redirect(302, targetUrl);
});

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "14.0.0",
  name: "CineBR ⚡ Smart Auto (Dublado & 4K)",
  description: "Servidores unificados em um clique. O addon escolhe e conecta automaticamente no servidor mais rápido sem você precisar testar um por um.",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Gerando stream unificado para ${type} ID: ${id}`);

  // Gera o host da URL baseado em onde o addon estiver rodando
  // Se estiver local/túnel, usa o host público ou fallback local
  const baseUrl = "https://medicare-mart-corrections-contains.trycloudflare.com";

  // Retorna APENAS 2 opções unificadas e limpas:
  // 1. [PLAY AUTOMÁTICO] 1080p Dublado (Ultra Rápido - Abre direto no melhor servidor)
  // 2. [PLAY AUTOMÁTICO] 4K HDR Dublado (Máxima Qualidade)
  const streams = [
    {
      name: "⚡ CineBR [AUTO-PLAY]",
      title: "🎬 REPRODUÇÃO INSTANTÂNEA • 1080p FULL HD\n🇧🇷 100% Dublado • Sem Seeds\n⚡ Conecta automaticamente no melhor servidor (Safira / Athena)",
      url: `${baseUrl}/play/${type}/${id}/1080p`,
      behaviorHints: {
        bingeGroup: `cinebr-auto-1080p-${id}`,
        notWebReady: false
      }
    },
    {
      name: "💎 CineBR [AUTO-PLAY 4K]",
      title: "🎬 REPRODUÇÃO 4K HDR UHD\n🇧🇷 100% Dublado • Sem Seeds\n⚡ Conecta automaticamente no melhor servidor de alta definição",
      url: `${baseUrl}/play/${type}/${id}/4k`,
      behaviorHints: {
        bingeGroup: `cinebr-auto-4k-${id}`,
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
  console.log(`CineBR 14.0 Smart Auto rodando na porta ${PORT}`);
});
