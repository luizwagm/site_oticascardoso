/* ==========================================================================
   server.js — Gerenciador do site Óticas Cardoso
   Node puro + SQLite nativo (node:sqlite) — zero dependências.
   · Site:   http://localhost:5184/
   · Painel: http://localhost:5184/admin/   (senha inicial: cardoso-admin)
   "Publicar" regenera o index.html (marcadores <!--#KEY-->) e o config.js.
   ========================================================================== */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

const Endereco = require("./lib/endereco");

const ROOT = __dirname;
/* A porta vem do ambiente, com 5184 de padrao. Sem isso a unidade do systemd
   nao consegue defini-la e as provas nao tem como subir numa porta propria —
   teriam de usar a 5184 e conversariam com o site que ja esta no ar. */
const PORT = Number(process.env.PORT) || 5184;
const UPLOAD_DIR = path.join(ROOT, "assets", "img", "uploads");
fs.mkdirSync(path.join(ROOT, "data"), { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(ROOT, "data", "site.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT, categoryLabel TEXT,
    price REAL NOT NULL DEFAULT 0, compareAt REAL, badge TEXT, image TEXT, sort INTEGER DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS testimonials (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, name TEXT, role TEXT, initials TEXT, sort INTEGER DEFAULT 0);
`);
// migração leve: colunas novas em bancos existentes
for (const col of [
  "description TEXT DEFAULT ''", "sizes TEXT DEFAULT ''",
  "status TEXT DEFAULT 'ativo'", "sku TEXT DEFAULT ''", "brand TEXT DEFAULT ''", "gtin TEXT DEFAULT ''",
  "stock INTEGER DEFAULT 10", "weight_g INTEGER DEFAULT 0",
  "length_cm REAL DEFAULT 0", "width_cm REAL DEFAULT 0", "height_cm REAL DEFAULT 0",
  "gallery TEXT DEFAULT ''", "seo_title TEXT DEFAULT ''", "seo_desc TEXT DEFAULT ''",
]) { try { db.exec(`ALTER TABLE products ADD COLUMN ${col}`); } catch {} }
db.exec("UPDATE products SET status='ativo' WHERE status IS NULL OR status=''");
db.exec("UPDATE products SET stock=10 WHERE stock IS NULL");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const getS = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setS = (k, v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, String(v));
const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ------------------------------- Seed ------------------------------------ */
function seed() {
  if (getS("hero_title")) return;
  const S = {
    admin_password_hash: sha("cardoso-admin"),
    hero_badge: "Caruaru-PE · Entrega para todo o Brasil",
    hero_title: "Veja o mundo com <em>outros olhos</em>.",
    hero_lead: "Armações de grau, óculos de sol e lentes escolhidos com o cuidado de quem entende de visão — e de gente. Tradição, qualidade e atendimento humano.",
    stats: JSON.stringify([
      { num: "Anos", label: "de tradição" },
      { num: "10mil+", label: "clientes atendidos" },
      { num: "BR", label: "entrega nacional" },
    ]),
    about_title: "Cuidar da sua visão é um ato de <em>carinho</em>.",
    about_lead: "Há anos as famílias de Caruaru confiam os seus olhos à Óticas Cardoso. Do exame de vista à armação perfeita, tratamos cada cliente como gente — porque é isso que somos.",
    about_bullets: JSON.stringify([
      "Armações e lentes de qualidade, com garantia",
      "Exame de vista completo na loja",
      "Atendimento que trata você pelo nome",
      "Condições para o seu bolso, sem abrir mão da qualidade",
    ]),
    whatsapp: "5500000000000",
    whatsapp_display: "(87) 00000-0000",
    instagram: "oticascardosoo",
    footer_tagline: "Tradição, qualidade e atendimento humano para cuidar da sua visão. Loja em Caruaru-PE e entrega para todo o Brasil.",
    cnpj: "00.000.000/0001-00",
  };
  for (const [k, v] of Object.entries(S)) setS(k, v);

  const P = [
    ["Aviador Clássico Dourado", "sol", "Sol", 389.9, 459.9, "Best-seller", "https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=600&q=70"],
    ["Wayfarer Acetato Tartaruga", "sol", "Sol", 349.9, null, "", "https://images.unsplash.com/photo-1572635196237-14b3f281503f?auto=format&fit=crop&w=600&q=70"],
    ["Redondo Vintage Âmbar", "sol", "Sol", 299.9, 359.9, "Oferta", "https://images.unsplash.com/photo-1577803645773-f96470509666?auto=format&fit=crop&w=600&q=70"],
    ["Armação Executiva Titânio", "grau", "Grau", 449.9, null, "Novidade", "https://images.unsplash.com/photo-1574258495973-f010dfbb5371?auto=format&fit=crop&w=600&q=70"],
    ["Armação Leve Transparente", "grau", "Grau", 279.9, null, "", "https://images.unsplash.com/photo-1591076482161-42ce6da69f67?auto=format&fit=crop&w=600&q=70"],
    ["Armação Gatinho Preta", "grau", "Grau", 319.9, 379.9, "", "https://images.unsplash.com/photo-1610136649349-0f646f318053?auto=format&fit=crop&w=600&q=70"],
    ["Lentes com Filtro Blue Light", "lentes", "Lentes", 199.9, null, "Escritório", "https://images.unsplash.com/photo-1614715838608-dd527c46231d?auto=format&fit=crop&w=600&q=70"],
    ["Armação Infantil Flexível", "infantil", "Infantil", 189.9, null, "", "https://images.unsplash.com/photo-1556306535-0f09a537f0a3?auto=format&fit=crop&w=600&q=70"],
  ];
  P.forEach((p, i) =>
    db.prepare("INSERT INTO products(id,name,category,categoryLabel,price,compareAt,badge,image,sort) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(slug(p[0]), p[0], p[1], p[2], p[3], p[4], p[5], p[6], i));

  [["Compro meus óculos lá há mais de dez anos. Atendimento de família, do exame à entrega.", "Maria José", "Cliente há 10 anos · Caruaru", "MJ"],
   ["Pedi pelo site e chegou perfeito, com a lente certinha do meu grau. Recomendo de olhos fechados.", "Rodrigo P.", "Compra online · Recife", "RP"],
   ["Levaram o maior cuidado com os óculos da minha filha. Voltamos sempre pros ajustes.", "Ana Clara", "Mãe da Alice · Toritama", "AC"]]
    .forEach((d, i) => db.prepare("INSERT INTO testimonials(text,name,role,initials,sort) VALUES(?,?,?,?,?)").run(d[0], d[1], d[2], d[3], i));

  console.log("· Banco inicializado. Senha do painel: cardoso-admin");
}
seed();

// migração: descrições/tamanhos dos produtos mock (só onde estiver vazio)
const MOCK_DETAILS = {
  "aviador-classico-dourado": ["O clássico que nunca sai de moda. Armação metálica dourada, lentes com proteção UV400 e o caimento que valoriza qualquer rosto. Acompanha estojo rígido e flanela.", ""],
  "wayfarer-acetato-tartaruga": ["Acetato italiano no padrão tartaruga, hastes reforçadas e lentes UV400. Um ícone atemporal para o dia a dia.", ""],
  "redondo-vintage-ambar": ["Estilo retrô com lentes âmbar e armação metálica fina. Leve, charmoso e cheio de personalidade.", ""],
  "armacao-executiva-titanio": ["Titânio ultraleve com acabamento fosco: quase imperceptível no rosto e resistente ao dia a dia intenso. Pronta para suas lentes de grau.", ""],
  "armacao-leve-transparente": ["Tendência das armações translúcidas em material flexível e hipoalergênico. Discreta, moderna e confortável do amanhecer ao anoitecer.", ""],
  "armacao-gatinho-preta": ["O clássico gatinho repaginado: acetato preto brilhante com detalhes que alongam o olhar. Elegância que acompanha do trabalho ao jantar.", ""],
  "lentes-com-filtro-blue-light": ["Par de lentes com filtro de luz azul para quem passa horas em telas. Reduz o cansaço visual e melhora o sono. Aplicamos na sua armação ou em uma nova.", ""],
  "armacao-infantil-flexivel": ["Feita para o mundo real das crianças: material flexível que torce sem quebrar, hastes emborrachadas e cores divertidas. Leveza e segurança para os pequenos.", ""],
};
for (const [id, [desc, sizes]] of Object.entries(MOCK_DETAILS)) {
  db.prepare("UPDATE products SET description=?, sizes=? WHERE id=? AND (description IS NULL OR description='')").run(desc, sizes, id);
}

/* ------------------------------ Sessões ---------------------------------- */
const sessions = new Map();
const authed = (req) => { const m = /(?:^|;\s*)sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); return m && sessions.has(m[1]); };

/* ------------------------------ Publicar --------------------------------- */
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const brl = (n) => Number(n).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const CHECK = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

function setMarker(html, key, content) {
  const re = new RegExp(`(<!--#${key}-->)[\\s\\S]*?(<!--\\/${key}-->)`);
  if (!re.test(html)) throw new Error(`Marcador ${key} não encontrado`);
  return html.replace(re, (_m, open, close) => `${open}\n${content}\n${close}`);
}

/* ==========================================================================
   A META ROBOTS ACOMPANHA O ENDEREÇO

   O HTML trazia `<meta name="robots" content="index, follow, ...">` escrito à
   mão. No endereço de aprovação isso dizia o CONTRÁRIO do cabeçalho HTTP: o
   `X-Robots-Tag` pedia noindex e a página pedia index.

   Na prática o Google resolve pela diretiva mais restritiva, e o noindex
   venceria — mas contar com isso é apostar. Basta a página ser salva, servida
   por outro caminho ou lida por um robô que só olhe o HTML para a contradição
   virar indexação. Duas fontes de verdade que discordam é sempre defeito,
   mesmo quando a sorte está do lado certo.

   ---------------------------------------------------------------------------
   E QUEM DECIDE É A PÁGINA, NÃO O VALOR QUE ESTAVA LÁ

   A primeira versão preservava o valor quando ele já dizia "noindex",
   pensando no checkout — que é fora do índice por natureza, sendo página de
   passagem.

   Isso criou um defeito que só aparece NA VIRADA, que é o pior momento
   possível: depois de rodar em aprovação, TODAS as páginas ficam com noindex
   no disco. Ao virar para o domínio público, a regra via "já é noindex" e
   preservava — e o site entrava no ar invisível para o Google, sem nenhum
   erro em lugar nenhum. Peguei isso testando a virada, não o estado.

   Agora quem chama diz se a página é fora do índice por natureza
   (`enderecar(html, true)`), e o valor anterior não influencia nada. Estado
   antigo nunca deve decidir estado novo.
   ========================================================================== */
/* Endereço + meta robots numa passada só. Os modelos de src/ trazem o
   canonical com o domínio escrito à mão, igual ao index — e as três páginas
   geradas a partir deles herdavam o defeito. */
function enderecar(html, sempreForaDoIndice = false) {
  return metaRobots(
    html.replace(/https:\/\/oticascardoso[a-z0-9.-]*/gi, Endereco.SITE),
    sempreForaDoIndice);
}

function metaRobots(html, sempreForaDoIndice = false) {
  const valor = (Endereco.INDEXAVEL && !sempreForaDoIndice)
    ? "index, follow, max-image-preview:large, max-snippet:-1"
    : "noindex, nofollow, noarchive";
  return html.replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/gi,
    `<meta name="robots" content="${valor}">`);
}

function publish() {
  const S = {}; for (const r of db.prepare("SELECT key,value FROM settings").all()) S[r.key] = r.value;
  // só produtos ATIVOS vão para o site (arquivados ficam guardados no banco)
  const products = db.prepare("SELECT * FROM products WHERE status='ativo' ORDER BY sort,id").all();
  const deps = db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all();

  const stats = JSON.parse(S.stats || "[]").map((s) =>
    `<div class="stat"><dd class="stat__num">${esc(s.num)}</dd><dt class="stat__label">${esc(s.label)}</dt></div>`).join("\n            ");

  const card = (p, i) => {
    const delay = i % 3 ? ` data-reveal-delay="${i % 3}"` : "";
    const out = Number(p.stock) <= 0;
    const badge = out
      ? `<span class="product__badge" style="background:#ff5c7a;color:#fff">Esgotado</span>`
      : p.badge ? `<span class="product__badge">${esc(p.badge)}</span>` : "";
    const price = p.compareAt ? `<s>${brl(p.compareAt)}</s>${brl(p.price)}` : brl(p.price);
    const href = `/produto/${p.id}/`;
    return `<article class="product" data-cat="${esc(p.category)}" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${Number(p.price).toFixed(2)}" data-img="${esc(p.image)}" data-stock="${Number(p.stock) || 0}" data-reveal${delay}>
            <a class="product__media" href="${href}" aria-label="Ver ${esc(p.name)}">${badge}<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy"></a>
            <div class="product__body"><span class="product__cat">${esc(p.categoryLabel)}</span><h3 class="product__name"><a href="${href}">${esc(p.name)}</a></h3>
              <div class="product__foot"><span class="product__price">${price}</span><button class="add-btn" aria-label="Adicionar ${esc(p.name)} à sacola"${out ? " disabled" : ""}>${PLUS}</button></div>
            </div>
          </article>`;
  };
  const productsHtml = products.map(card).join("\n          ");

  const bullets = JSON.parse(S.about_bullets || "[]").map((b) => `<li>${CHECK} ${esc(b)}</li>`).join("\n            ");

  const depsHtml = deps.map((t, i) => `<figure class="quote" data-reveal${i % 3 ? ` data-reveal-delay="${i % 3}"` : ""}>
            <div class="quote__stars" aria-label="5 de 5">★★★★★</div>
            <blockquote class="quote__text">“${esc(t.text)}”</blockquote>
            <figcaption class="quote__author"><span class="avatar">${esc(t.initials)}</span><span><span class="quote__name">${esc(t.name)}</span><br><span class="quote__role">${esc(t.role)}</span></span></figcaption>
          </figure>`).join("\n          ");

  const contactInfo = `<li><a href="https://wa.me/${esc(S.whatsapp)}" target="_blank" rel="noopener">WhatsApp: ${esc(S.whatsapp_display)}</a></li>
            <li><a href="https://www.instagram.com/${esc(S.instagram)}" target="_blank" rel="noopener">@${esc(S.instagram)}</a></li>
            <li><span>Caruaru · PE</span></li>`;

  /* O ENDERECO VEM DO AMBIENTE, nao do codigo.
     Estava escrito "https://oticascardoso.com" em quatro lugares deste
     arquivo. Subir a versao de aprovacao assim faria o Google indexar a
     demonstracao E trata-la como a versao oficial do dominio final, por causa
     do canonical. Ver lib/endereco.js. */
  const SITE = Endereco.SITE;

  const jsonld = { "@context": "https://schema.org", "@graph": [
    { "@type": "Organization", "@id": `${SITE}/#org`, name: "Óticas Cardoso",
      url: `${SITE}/`, logo: `${SITE}/assets/img/favicon.svg`,
      sameAs: [`https://www.instagram.com/${S.instagram}`] },
    { "@type": "Optician", "@id": `${SITE}/#store`, name: "Óticas Cardoso",
      image: `${SITE}/assets/img/favicon.svg`, url: `${SITE}/`,
      description: "Ótica com armações de grau, óculos de sol, lentes e exame de vista. Loja em Caruaru-PE e e-commerce para todo o Brasil.",
      telephone: "+" + S.whatsapp,
      address: { "@type": "PostalAddress", addressLocality: "Caruaru", addressRegion: "PE", addressCountry: "BR" },
      areaServed: "BR", priceRange: "$$",
      parentOrganization: { "@id": `${SITE}/#org` } },
    { "@type": "WebSite", url: `${SITE}/`, name: "Óticas Cardoso", inLanguage: "pt-BR",
      publisher: { "@id": `${SITE}/#org` } },
  ] };
  const jsonldHtml = `<script type="application/ld+json">\n  ${JSON.stringify(jsonld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`;

  const idx = path.join(ROOT, "index.html");
  let html = fs.readFileSync(idx, "utf8");
  html = setMarker(html, "JSONLD", "  " + jsonldHtml);
  html = setMarker(html, "HERO_BADGE", S.hero_badge);
  html = setMarker(html, "HERO_TITLE", S.hero_title);
  html = setMarker(html, "HERO_LEAD", S.hero_lead);
  html = setMarker(html, "STATS", "            " + stats);
  html = setMarker(html, "PRODUCTS", "          " + productsHtml);
  html = setMarker(html, "ABOUT_TITLE", S.about_title);
  html = setMarker(html, "ABOUT_LEAD", S.about_lead);
  html = setMarker(html, "ABOUT_BULLETS", "            " + bullets);
  html = setMarker(html, "TESTIMONIALS", "          " + depsHtml);
  html = setMarker(html, "CONTACT_INFO", "            " + contactInfo);
  html = setMarker(html, "FOOTER_TAGLINE", S.footer_tagline);
  html = setMarker(html, "CNPJ", S.cnpj);
  html = html.replace(/wa\.me\/\d+/g, `wa.me/${S.whatsapp}`);

  /* ---------------------------------------------------------- o canonical
     O index.html traz `canonical`, `og:url` e `og:image` escritos a mao, e
     eles NAO sao marcadores — o publish nunca os tocava. Resultado: o site
     rodando no endereco de aprovacao declarava canonical para o dominio
     final, mandando o Google tratar a demonstracao como a versao oficial.

     A troca casa QUALQUER host que comece por "oticascardoso", e nao apenas o
     .com — assim ela funciona nos dois sentidos (virada e volta) e e
     idempotente: rodar de novo com o mesmo SITE nao muda nada.

     O `https://www.instagram.com/oticascardosoo` nao casa, porque a expressao
     exige que o host COMECE com oticascardoso. */
  html = html.replace(/https:\/\/oticascardoso[a-z0-9.-]*/gi, SITE);
  html = metaRobots(html);

  fs.writeFileSync(idx, html);

  const cfgPath = path.join(ROOT, "assets/js/config.js");
  let cfg = fs.readFileSync(cfgPath, "utf8");
  cfg = cfg.replace(/WHATSAPP_NUMBER = "[^"]*"/, `WHATSAPP_NUMBER = "${S.whatsapp}"`);
  fs.writeFileSync(cfgPath, cfg);

  /* ---------- /loja/ (página independente) ---------- */
  const lojaJsonld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [
        { "@type": "ListItem", position: 1, name: "Início", item: `${SITE}/` },
        { "@type": "ListItem", position: 2, name: "Loja", item: `${SITE}/loja/` } ] },
      { "@type": "ItemList", name: "Catálogo Óticas Cardoso",
        itemListElement: products.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/produto/${p.id}/` })) },
    ],
  });
  let lojaHtml = fs.readFileSync(path.join(ROOT, "src/loja.html"), "utf8")
    .replaceAll("{{PRODUCTS}}", "          " + productsHtml)
    .replaceAll("{{CONTACT_INFO}}", "            " + contactInfo)
    .replaceAll("{{FOOTER_TAGLINE}}", S.footer_tagline)
    .replaceAll("{{CNPJ}}", esc(S.cnpj))
    .replaceAll("{{JSONLD}}", lojaJsonld)
    .replace(/wa\.me\/\d+/g, `wa.me/${S.whatsapp}`);
  fs.mkdirSync(path.join(ROOT, "loja"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "loja/index.html"), enderecar(lojaHtml));

  /* ---------- /produto/<id>/ (uma página por produto) ---------- */
  const pdpTpl = fs.readFileSync(path.join(ROOT, "src/produto.html"), "utf8");
  for (const p of products) {
    const url = `${SITE}/produto/${p.id}/`;
    const out = Number(p.stock) <= 0;
    const desc = p.description || `${p.name} com a qualidade e a garantia Óticas Cardoso. Entrega para todo o Brasil ou retirada na loja em Caruaru-PE.`;
    const metaDesc = p.seo_desc || (desc.length > 155 ? desc.slice(0, 152) + "…" : desc);
    const pageTitle = p.seo_title || p.name;
    const off = p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0;
    const priceRow =
      `<span class="pdp__price">${brl(p.price)}</span>` +
      (p.compareAt ? `<span class="pdp__price-old">${brl(p.compareAt)}</span><span class="pdp__off">-${off}%</span>` : "");
    const sizes = String(p.sizes || "").split(",").map((s) => s.trim()).filter(Boolean);
    const sizesHtml = sizes.length && !out
      ? `<div><div class="sizes__label">Tamanho <span></span></div><div class="sizes">` +
        sizes.map((s) => `<button class="size-btn" data-size="${esc(s)}" aria-pressed="false">${esc(s)}</button>`).join("") +
        `</div></div>`
      : "";
    // galeria: imagem principal + extras (uma URL por linha no cadastro)
    const gallery = [p.image, ...String(p.gallery || "").split("\n").map((s) => s.trim()).filter(Boolean)];
    const galleryHtml = gallery.length > 1
      ? `<div class="pdp__thumbs" role="group" aria-label="Fotos do produto">` +
        gallery.map((g, gi) => `<button class="pdp-thumb" data-src="${esc(g)}" aria-pressed="${gi === 0}" aria-label="Foto ${gi + 1}" style="background-image:url('${esc(g)}')"></button>`).join("") +
        `</div>`
      : "";
    const waText = encodeURIComponent(`Olá! Quero o produto: ${p.name} (${brl(p.price)}) 👓`);
    const buyHtml = out
      ? `<div class="pdp__buy"><span class="pdp__soldout">Esgotado — avise-me pelo WhatsApp</span>
            <a class="btn btn--ghost" href="https://wa.me/${esc(S.whatsapp)}?text=${encodeURIComponent(`Olá! Quando o produto "${p.name}" voltar ao estoque, me avisa? 👓`)}" target="_blank" rel="noopener" style="flex:1;min-width:240px">Quero ser avisado</a></div>`
      : `<div class="pdp__buy">
            <button class="btn btn--neon add-btn">Adicionar à sacola
              <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
            </button>
            <a class="btn btn--ghost" href="https://wa.me/${esc(S.whatsapp)}?text=${waText}" target="_blank" rel="noopener">Comprar pelo WhatsApp</a>
          </div>`;
    const related = products.filter((x) => x.id !== p.id && x.category === p.category);
    const relatedFill = related.length >= 4 ? related : related.concat(products.filter((x) => x.id !== p.id && x.category !== p.category));
    const relatedHtml = relatedFill.slice(0, 4).map(card).join("\n          ");
    const productLd = { "@type": "Product", name: p.name, sku: p.sku || p.id, category: p.categoryLabel,
      description: desc, image: gallery,
      brand: { "@type": "Brand", name: p.brand || "Óticas Cardoso" },
      offers: { "@type": "Offer", priceCurrency: "BRL", price: Number(p.price).toFixed(2),
        availability: out ? "https://schema.org/OutOfStock" : "https://schema.org/InStock", url,
        itemCondition: "https://schema.org/NewCondition",
        seller: { "@type": "Organization", name: "Óticas Cardoso" } } };
    if (p.gtin) productLd.gtin13 = p.gtin;
    if (p.weight_g > 0) productLd.weight = { "@type": "QuantitativeValue", value: p.weight_g, unitCode: "GRM" };
    const jsonld = JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        productLd,
        { "@type": "BreadcrumbList", itemListElement: [
          { "@type": "ListItem", position: 1, name: "Início", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Loja", item: `${SITE}/loja/` },
          { "@type": "ListItem", position: 3, name: p.name, item: url } ] },
      ],
    });
    const pdp = pdpTpl
      .replaceAll("{{PAGE_TITLE}}", esc(pageTitle))
      .replaceAll("{{NAME}}", esc(p.name))
      .replaceAll("{{ID}}", p.id)
      .replaceAll("{{CATEGORY}}", esc(p.category))
      .replaceAll("{{CATEGORY_LABEL}}", esc(p.categoryLabel))
      .replaceAll("{{PRICE_ATTR}}", Number(p.price).toFixed(2))
      .replaceAll("{{STOCK_ATTR}}", String(Number(p.stock) || 0))
      .replaceAll("{{PRICE_ROW}}", priceRow)
      .replaceAll("{{IMAGE}}", esc(p.image))
      .replaceAll("{{BADGE_HTML}}", out ? `<span class="product__badge" style="background:#ff5c7a;color:#fff">Esgotado</span>` : p.badge ? `<span class="product__badge">${esc(p.badge)}</span>` : "")
      .replaceAll("{{GALLERY_HTML}}", galleryHtml)
      .replaceAll("{{BUY_HTML}}", buyHtml)
      .replaceAll("{{DESCRIPTION}}", esc(desc))
      .replaceAll("{{META_DESC}}", esc(metaDesc))
      .replaceAll("{{SIZES_HTML}}", sizesHtml)
      .replaceAll("{{RELATED}}", "          " + relatedHtml)
      .replaceAll("{{CNPJ}}", esc(S.cnpj))
      .replaceAll("{{JSONLD}}", jsonld);
    fs.mkdirSync(path.join(ROOT, "produto", p.id), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "produto", p.id, "index.html"), enderecar(pdp));
  }

  /* ---------- /checkout/ ---------- */
  let coHtml = fs.readFileSync(path.join(ROOT, "src/checkout.html"), "utf8")
    .replaceAll("{{CNPJ}}", esc(S.cnpj))
    .replace(/wa\.me\/\d+/g, `wa.me/${S.whatsapp}`);
  fs.mkdirSync(path.join(ROOT, "checkout"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "checkout/index.html"), enderecar(coHtml, true));
  // remove páginas de produtos excluídos
  const alive = new Set(products.map((p) => p.id));
  const prodDir = path.join(ROOT, "produto");
  if (fs.existsSync(prodDir)) {
    for (const d of fs.readdirSync(prodDir)) {
      if (!alive.has(d)) fs.rmSync(path.join(prodDir, d), { recursive: true, force: true });
    }
  }

  /* ---------- sitemap.xml ---------- */
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE}/`, pri: "1.0" },
    { loc: `${SITE}/loja/`, pri: "0.9" },
    ...products.map((p) => ({ loc: `${SITE}/produto/${p.id}/`, pri: "0.8" })),
  ];
  fs.writeFileSync(path.join(ROOT, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <priority>${u.pri}</priority>\n  </url>`).join("\n") +
    `\n</urlset>\n`);

  return { products: products.length, testimonials: deps.length, pages: 2 + products.length };
}

/* ------------------------------ HTTP util --------------------------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".txt": "text/plain" };
const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok, bad) => {
  let d = "", n = 0;
  req.on("data", (c) => { n += c.length; if (n > 25e6) { bad(new Error("payload muito grande")); req.destroy(); } d += c; });
  req.on("end", () => { try { ok(d ? JSON.parse(d) : {}); } catch { bad(new Error("JSON inválido")); } });
});
const KEYS = ["hero_badge", "hero_title", "hero_lead", "stats", "about_title", "about_lead", "about_bullets",
  "whatsapp", "whatsapp_display", "instagram", "footer_tagline", "cnpj"];
const PRODUCT_COLS = ["name", "category", "categoryLabel", "price", "compareAt", "badge", "image", "sort", "description", "sizes",
  "status", "sku", "brand", "gtin", "stock", "weight_g", "length_cm", "width_cm", "height_cm", "gallery", "seo_title", "seo_desc"];
const NUM_COLS = new Set(["price", "compareAt", "stock", "weight_g", "length_cm", "width_cm", "height_cm", "sort"]);

/* ------------------------------ Servidor ---------------------------------- */
http.createServer(async (req, res) => {
  const p = new URL(req.url, `http://localhost:${PORT}`).pathname;

  /* ========================================================================
     O CABEÇALHO DE ROBÔS, EM TODA RESPOSTA

     No endereço de aprovação TUDO sai marcado como fora do índice — HTML,
     CSS, imagem, JSON. O robots.txt evita a VISITA do robô; este cabeçalho
     evita a INDEXAÇÃO de quem chegou por um link, e link de aprovação circula
     no WhatsApp o tempo todo.

     Envolver o `writeHead` em vez de repetir o cabeçalho em cada `res.writeHead`
     do arquivo: são mais de dez, e a décima primeira que alguém escrever
     amanhã nasceria sem ele. A trava fica no caminho, não na disciplina.

     Trata as duas assinaturas de `writeHead` — (código, cabeçalhos) e
     (código, frase, cabeçalhos) — porque errar isso apagaria os cabeçalhos
     originais em silêncio. */
  if (Endereco.CABECALHO_ROBOS) {
    const original = res.writeHead.bind(res);
    res.writeHead = (codigo, a2, a3) => {
      const cabs = (a3 && typeof a3 === "object") ? a3
        : (a2 && typeof a2 === "object") ? a2 : {};
      const juntos = Object.assign({ "X-Robots-Tag": Endereco.CABECALHO_ROBOS }, cabs);
      return (a3 && typeof a3 === "object")
        ? original(codigo, a2, juntos)
        : original(codigo, juntos);
    };
  }

  try {
    /* ---------------------------------------------------------------- saúde
       O deploy pede isto com `curl -fsS` depois de reiniciar, e `-f` falha em
       404: sem a rota, toda entrega reportaria que o site não subiu — com o
       site no ar. Vem ANTES de tudo para não depender de nenhuma outra regra. */
    if (p === "/saude") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({
        ok: true, site: Endereco.SITE, indexavel: Endereco.INDEXAVEL,
        versao: require("./package.json").version,
      }));
    }

    /* ------------------------------------------------------------- robots
       GERADO, e não lido do disco. O arquivo estático dizia `Allow: /` com o
       Sitemap do domínio final — subir a versão de aprovação assim convidaria
       o Google a indexar a demonstração. Agora ele acompanha o endereço. */
    if (p === "/robots.txt") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end(Endereco.robots());
    }

    /* ------------------------------------------------------------ sitemap
       No endereço de trabalho ele sai VAZIO, e não com as URLs de trabalho
       dentro: sitemap preenchido é convite explícito para indexar, e
       contradiz o robots.txt que acabou de pedir o contrário. */
    if (p === "/sitemap.xml" && !Endereco.INDEXAVEL) {
      res.writeHead(200, { "Content-Type": "application/xml; charset=utf-8" });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>
`);
    }

    if (p.startsWith("/api/")) {
      if (p === "/api/login" && req.method === "POST") {
        const { password } = await readBody(req);
        if (sha(password) !== getS("admin_password_hash")) return json(res, 401, { error: "Senha incorreta" });
        const t = crypto.randomBytes(24).toString("hex");
        sessions.set(t, Date.now());
        res.setHeader("Set-Cookie", `sid=${t}; HttpOnly; Path=/; SameSite=Lax`);
        return json(res, 200, { ok: true });
      }
      if (!authed(req)) return json(res, 401, { error: "Não autenticado" });
      if (p === "/api/me") return json(res, 200, { ok: true });
      if (p === "/api/logout" && req.method === "POST") {
        const m = /sid=([a-f0-9]+)/.exec(req.headers.cookie || ""); if (m) sessions.delete(m[1]);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/password" && req.method === "POST") {
        const { current, next } = await readBody(req);
        if (sha(current) !== getS("admin_password_hash")) return json(res, 400, { error: "Senha atual incorreta" });
        if (!next || String(next).length < 6) return json(res, 400, { error: "Nova senha deve ter 6+ caracteres" });
        setS("admin_password_hash", sha(next));
        return json(res, 200, { ok: true });
      }
      if (p === "/api/content") {
        const S = {}; for (const k of KEYS) S[k] = getS(k) || "";
        return json(res, 200, {
          settings: S,
          products: db.prepare("SELECT * FROM products ORDER BY sort,id").all(),
          testimonials: db.prepare("SELECT * FROM testimonials ORDER BY sort,id").all(),
        });
      }
      if (p === "/api/settings" && req.method === "PUT") {
        const b = await readBody(req);
        for (const [k, v] of Object.entries(b)) if (KEYS.includes(k)) setS(k, v);
        return json(res, 200, { ok: true });
      }
      if (p === "/api/products" && req.method === "POST") {
        const b = await readBody(req);
        const id = slug(b.name || "produto") + "-" + Date.now().toString(36).slice(-4);
        db.prepare(`INSERT INTO products(id,name,category,categoryLabel,price,compareAt,badge,image,sort,description,sizes,status,sku,brand,gtin,stock,weight_g,length_cm,width_cm,height_cm,gallery,seo_title,seo_desc)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, b.name || "Novo produto", b.category || "grau", b.categoryLabel || "Grau",
            parseFloat(b.price) || 0, b.compareAt ? parseFloat(b.compareAt) : null, b.badge || "", b.image || "", b.sort ?? 99,
            b.description || "", b.sizes || "", b.status || "ativo", b.sku || "", b.brand || "", b.gtin || "",
            parseInt(b.stock) || 0, parseInt(b.weight_g) || 0, parseFloat(b.length_cm) || 0, parseFloat(b.width_cm) || 0,
            parseFloat(b.height_cm) || 0, b.gallery || "", b.seo_title || "", b.seo_desc || "");
        return json(res, 200, { ok: true, id });
      }
      const pm = p.match(/^\/api\/products\/([a-z0-9-]+)$/);
      if (pm && req.method === "PUT") {
        const b = await readBody(req);
        const sets = [], vals = [];
        for (const c of PRODUCT_COLS) if (c in b) {
          sets.push(`${c}=?`);
          if (c === "compareAt") vals.push(b[c] === "" || b[c] == null ? null : parseFloat(b[c]) || null);
          else if (NUM_COLS.has(c)) vals.push(parseFloat(b[c]) || 0);
          else vals.push(b[c]);
        }
        if (sets.length) db.prepare(`UPDATE products SET ${sets.join(",")} WHERE id=?`).run(...vals, pm[1]);
        return json(res, 200, { ok: true });
      }
      if (pm && req.method === "DELETE") {
        db.prepare("DELETE FROM products WHERE id=?").run(pm[1]);
        return json(res, 200, { ok: true });
      }
      const tm = p.match(/^\/api\/testimonials(?:\/(\d+))?$/);
      if (tm) {
        const id = tm[1], cols = ["text", "name", "role", "initials", "sort"];
        if (req.method === "POST" && !id) {
          const b = await readBody(req);
          const use = cols.filter((c) => c in b);
          db.prepare(`INSERT INTO testimonials(${use.join(",")}) VALUES(${use.map(() => "?").join(",")})`).run(...use.map((c) => b[c]));
          return json(res, 200, { ok: true });
        }
        if (req.method === "PUT" && id) {
          const b = await readBody(req);
          const use = cols.filter((c) => c in b);
          if (use.length) db.prepare(`UPDATE testimonials SET ${use.map((c) => c + "=?").join(",")} WHERE id=?`).run(...use.map((c) => b[c]), id);
          return json(res, 200, { ok: true });
        }
        if (req.method === "DELETE" && id) {
          db.prepare("DELETE FROM testimonials WHERE id=?").run(id);
          return json(res, 200, { ok: true });
        }
      }
      if (p === "/api/upload" && req.method === "POST") {
        const { name, dataUrl } = await readBody(req);
        const m = /^data:(image\/(?:png|jpe?g|webp|svg\+xml|gif));base64,(.+)$/.exec(dataUrl || "");
        if (!m) return json(res, 400, { error: "Envie uma imagem (png, jpg, webp, svg ou gif)" });
        const safe = slug(path.parse(name || "foto").name).slice(0, 40) || "foto";
        const ext = m[1] === "image/svg+xml" ? ".svg" : "." + m[1].split("/")[1].replace("jpeg", "jpg");
        const file = `${Date.now().toString(36)}-${safe}${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, file), Buffer.from(m[2], "base64"));
        return json(res, 200, { ok: true, path: `/assets/img/uploads/${file}` });
      }
      if (p === "/api/publish" && req.method === "POST") return json(res, 200, { ok: true, ...publish() });
      return json(res, 404, { error: "Rota não encontrada" });
    }

    if (p === "/admin" || p === "/admin/") {
      res.writeHead(200, { "Content-Type": MIME[".html"] });
      return res.end(fs.readFileSync(path.join(ROOT, "admin", "index.html")));
    }
    /* ========================================================================
       O QUE PODE SER SERVIDO — POR LUGAR, NÃO POR EXCLUSÃO

       A versão anterior era uma lista de PROIBIDOS: bloqueava `/data` e
       `/server.js`, e servia todo o resto da pasta do projeto. Duas coisas
       erradas com isso:

         1. `/src/loja.html`, `/src/produto.html` e `/src/checkout.html` eram
            entregues a quem pedisse — são os modelos internos do gerador, com
            os marcadores que mostram como o site é montado por dentro.

         2. E o modo de falhar é para SEMPRE PIOR: tudo que ninguém lembrar de
            proibir vaza. Um `.env` posto na raiz amanhã, um `backup.sql`, um
            `notas.txt` — nenhum deles está na lista, todos seriam servidos com
            200. A lista de proibidos precisa prever o futuro; a de permitidos,
            não.

       Agora vale o contrário: nada é servido, exceto o que está declarado
       aqui. Arquivo novo na raiz nasce invisível — e quem quiser publicá-lo
       precisa dizer isso de propósito, nesta lista.
       ======================================================================== */
    const PASTAS_PUBLICAS = ["assets", "loja", "produto", "checkout"];
    const ARQUIVOS_PUBLICOS = new Set([
      "/", "/index.html", "/sitemap.xml", "/manifest.webmanifest",
      "/favicon.ico",
      /* `/robots.txt` NÃO entra: ele é gerado lá em cima, e acompanha o
         endereço. Se estivesse aqui, o arquivo estático do disco — que diz
         `Allow: /` — venceria e o site de aprovação viraria indexável. */
    ]);

    const primeira = p.split("/")[1] || "";
    const permitido = ARQUIVOS_PUBLICOS.has(p) || PASTAS_PUBLICAS.includes(primeira);
    if (!permitido) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }

    let file = path.normalize(path.join(ROOT, decodeURIComponent(p)));
    /* A conferência de saída da pasta continua, e continua NECESSÁRIA: sem
       ela, `/assets/../server.js` passaria pela lista acima (a primeira pasta
       é "assets") e sairia do lugar autorizado. As duas defesas resolvem
       perguntas diferentes — "pode?" e "é aqui dentro?". */
    if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end("403"); }
    if (p === "/") file = path.join(ROOT, "index.html");
    else if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("404"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(fs.readFileSync(file));
  } catch (e) { json(res, 500, { error: e.message }); }
}).listen(PORT, () => {
  console.log(`\n  Óticas Cardoso — site + gerenciador`);
  console.log(`  · Site:   http://localhost:${PORT}/`);
  console.log(`  · Painel: http://localhost:${PORT}/admin/  (senha inicial: cardoso-admin)`);
  console.log(`  · Endereço: ${Endereco.SITE}`);

  /* ========================================================================
     O CANONICAL SE CORRIGE SOZINHO NA SUBIDA

     As páginas deste site são ARQUIVOS no disco, reescritos pelo publish()
     quando alguém clica em "Publicar" no painel. O canonical e o og:url moram
     dentro delas.

     Isso cria uma armadilha na virada de endereço: trocar o OC_SITE no .env e
     reiniciar NÃO bastaria — o index.html no disco continuaria com o endereço
     antigo até alguém entrar no painel e publicar. E ninguém lembraria, porque
     nada na tela denuncia: o site abre normal, bonito, e manda o Google
     indexar o endereço errado.

     Aqui a conferência é feita a cada subida. Se o HTML no disco não fala do
     endereço em que estamos rodando, ele é republicado na hora. É barato (uma
     leitura de arquivo) e transforma a virada de domínio em "editar o .env e
     reiniciar", que é o que o criar-site.sh faz.
     ======================================================================== */
  try {
    /* Conferir MAIS DE UMA página, e mais de uma coisa em cada.
       A primeira versão olhava só o index.html e concluía pelas dez. Resultado
       observado: o index estava certo (corrigido à mão), a conferência passou,
       e a loja, o checkout e os oito produtos continuaram com o canonical do
       domínio errado — sem nenhum aviso.

       Também confere a META ROBOTS, e não só o canonical: as duas vêm do mesmo
       lugar, mas nada garante que andem juntas. */
    const alvos = ["index.html", "loja/index.html", "checkout/index.html"];
    let motivo = "";

    for (const rel of alvos) {
      const cam = path.join(ROOT, rel);
      if (!fs.existsSync(cam)) { motivo = `${rel} não existe`; break; }
      const h = fs.readFileSync(cam, "utf8");

      const canon = (h.match(/rel="canonical"\s+href="([^"]*)"/) || [])[1] || "";
      if (canon && !canon.startsWith(Endereco.SITE)) {
        motivo = `${rel} aponta o canonical para "${canon}"`; break;
      }

      /* A meta robots é conferida NOS DOIS SENTIDOS.
         A primeira versão só reclamava quando o noindex FALTAVA. Na virada
         para produção o defeito é o contrário — ele SOBRA — e o site entra no
         ar invisível para o Google. Uma conferência que só olha um lado
         aprova metade dos casos por não perguntar. */
      const rob = (h.match(/name="robots"\s+content="([^"]*)"/) || [])[1] || "";
      /* O checkout é fora do índice nos dois modos, de propósito: página de
         passagem não responde a busca nenhuma. */
      const deveEstarFora = !Endereco.INDEXAVEL || rel.startsWith("checkout/");
      const estaFora = /noindex/i.test(rob);
      if (rob && deveEstarFora !== estaFora) {
        motivo = deveEstarFora
          ? `${rel} tem meta robots "${rob}" num endereço de aprovação`
          : `${rel} está com "${rob}" num domínio público — ficaria invisível no Google`;
        break;
      }
    }

    if (motivo) {
      const r = publish();
      console.log(`  · ${motivo} — republiquei ${r.pages} páginas`);
    }
  } catch (e) {
    /* Republicar é conveniência, não pré-requisito: se falhar, o site continua
       no ar com o que estiver no disco. Derrubar o servidor por causa disto
       seria trocar um defeito de SEO por um site fora do ar. */
    console.log(`  · não consegui conferir o canonical: ${e.message}`);
  }

  if (!Endereco.INDEXAVEL) {
    console.log(`  ⚠ endereço de TRABALHO — fora do índice do Google`);
  }

  /* Os avisos do que ainda é de demonstração aparecem A CADA SUBIDA. É o que
     impede o site de ir ao ar vendendo com foto de banco de imagens. */
  const S = {}; for (const r of db.prepare("SELECT key,value FROM settings").all()) S[r.key] = r.value;
  const stock = db.prepare("SELECT COUNT(*) n FROM products WHERE image LIKE 'https://images.unsplash%'").get().n;
  const pendentes = [];
  if (stock) pendentes.push(`${stock} produto(s) ainda com FOTO DE BANCO DE IMAGENS — o cliente receberia outro óculos`);
  if (String(S.whatsapp || "").includes("0000")) pendentes.push("O WhatsApp é o número de exemplo.");
  if (S.cnpj === "00.000.000/0001-00") pendentes.push("O CNPJ é o de exemplo, e ele sai no rodapé.");
  if (pendentes.length) {
    console.log("");
    for (const p of pendentes) console.log("  ⚠  " + p);
  }
  console.log("");
});
