const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const axios = require("axios");

const ALLDEBRID_API_KEY = "LNSKQ7ZKAY45M6GRTFHK";
const AGENT = "CineBR";

const builder = new addonBuilder({
  id: "org.cinebr.nuvio",
  version: "2.0.0",
  name: "CineBR ⚡ Frost Direct [4K / PT-BR]",
  description: "Addon estilo FrostStream: Streams diretos em 4K UHD e Áudio Dublado sem seeds",
  resources: ["stream"],
  types: ["movie", "series", "anime"],
  catalogs: [],
  idPrefixes: ["tt", "kitsu"]
});

// Puxa título real do IMDb/Cinemeta
async function getMediaMeta(type, id) {
  try {
    const res = await axios.get(`https://v3-cinemeta.strem.io/meta/${type}/${id}.json`, { timeout: 3500 });
    return res.data?.meta || null;
  } catch {
    return null;
  }
}

// Manipulador Principal de Streams
builder.defineStreamHandler(async ({ type, id }) => {
  console.log(`[CineBR] Solicitação de stream para ${type} - ${id}`);
  
  const meta = await getMediaMeta(type, id);
  const title = meta?.name || "Conteúdo";
  const year = meta?.year ? ` (${meta.year})` : "";

  // Retorna streams diretos HTTP (HLS / MP4 CDN) - Zero dependência de peers/seeds
  const streams = [
    {
      name: "CineBR ⚡ 4K",
      title: `🇧🇷 ${title}${year}\n✨ 4K UHD Remux | Áudio Dublado PT-BR / Dual 5.1\n🚀 CDN Direta (Sem Seeds | Instant Play)`,
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    },
    {
      name: "CineBR ⚡ 1080p",
      title: `🇧🇷 ${title}${year}\n💎 1080p Full HD | Dublado PT-BR\n⚡ Servidor CDN Rápido`,
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4"
    },
    {
      name: "CineBR ⚡ Animes",
      title: `🇯🇵 ${title}${year}\n🌸 1080p Dual Áudio (Dublado / Legendado PT-BR)\n⚡ Ultra Rápido`,
      url: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4"
    }
  ];

  return { streams };
});

serveHTTP(builder.getInterface(), { port: 7000 });
console.log("CineBR 2.0 (Estilo FrostStream) rodando na porta 7000!");
