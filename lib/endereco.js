"use strict";
/* ==========================================================================
   ENDEREÇO — em que domínio este site está rodando

   ---------------------------------------------------------------------------
   POR QUE ISTO PRECISOU EXISTIR

   Até agora `https://oticascardoso.com` estava ESCRITO no código, em quatro
   lugares: o JSON-LD do server.js, o `const SITE` do publish(), o index.html e
   o robots.txt. E o robots dizia `Allow: /`.

   Subir isso em `oticascardoso.projetos.luizaugust.me` para o cliente aprovar
   produziria o pior resultado possível:

     · o endereço de trabalho seria INDEXADO pelo Google — com fotos de banco
       de imagens e preços de demonstração;
     · e ele declararia canonical para `oticascardoso.com`, mandando o Google
       tratar a demonstração como a versão oficial de um site que ainda nem
       existe.

   Tirar isso do índice depois leva semanas. O link de aprovação circula no
   WhatsApp, e basta uma pessoa compartilhar.

   ---------------------------------------------------------------------------
   O ENDEREÇO DE TRABALHO NASCE INVISÍVEL, SEM NINGUÉM PRECISAR LEMBRAR

   A regra é automática de propósito: qualquer endereço em
   `.projetos.luizaugust.me` é trabalho, e trabalho não é publicado. Não há
   caixa para marcar nem passo para esquecer.

   Trocar de domínio, no dia da virada, é editar o `.env` e reiniciar.
   ========================================================================== */

/* Sem barra no fim: o resto do código monta `SITE + "/loja/"`, e duas barras
   num canonical fazem o Google tratar como outra página. */
const SITE = String(process.env.OC_SITE || "https://oticascardoso.projetos.luizaugust.me")
  .trim().replace(/\/+$/, "");

const HOST = SITE.replace(/^https?:\/\//, "");

/* A conferência é pelo SUFIXO. Um domínio que apenas CONTENHA o texto no meio
   — `projetos.luizaugust.me.exemplo.com` — não é nosso subdomínio. */
const DE_TRABALHO = /(^|\.)projetos\.luizaugust\.me$/i.test(HOST)
  || HOST.startsWith("localhost")
  || HOST.startsWith("127.0.0.1");

/* Escape de válvula nos dois sentidos, sem mexer no código. Serve para o dia
   da virada — e para provar o comportamento num teste. */
const forcado = String(process.env.OC_INDEXAVEL || "").toLowerCase();
const INDEXAVEL = forcado === "sim" ? true
  : forcado === "nao" ? false
  : !DE_TRABALHO;

/* O cabeçalho vai em TODA resposta do endereço de trabalho, não só no HTML: o
   robots.txt evita a VISITA, o `X-Robots-Tag` evita a INDEXAÇÃO de quem chegou
   por um link — e link de aprovação circula no WhatsApp o tempo todo. */
const CABECALHO_ROBOS = INDEXAVEL ? null : "noindex, nofollow, noarchive";

/* ==========================================================================
   O robots.txt de cada caso

   ⚠ `robots.txt` NÃO HERDA. Cada robô obedece a UM grupo — o mais específico
   que casa com o nome dele — e ignora o `User-agent: *` por inteiro. Um grupo
   `User-agent: GPTBot` com apenas `Allow: /` LIBERARIA o painel para ele,
   porque o `Disallow` moraria no outro grupo.

   Por isso as proibições ficam numa lista só, e são repetidas em TODO grupo.
   ========================================================================== */
function robots() {
  if (!INDEXAVEL) {
    return `# Endereço de trabalho — este site não é para ser indexado.
# É uma versão em aprovação, com fotos e preços de demonstração.
# O endereço público é outro. Ver lib/endereco.js.
User-agent: *
Disallow: /
`;
  }

  /* O /checkout/ fica de fora do índice por ser página de passagem: ela não
     responde a nenhuma busca e, indexada, aparece vazia no resultado. O
     /admin/ é óbvio. */
  const PROIBIDO = ["/admin/", "/checkout/"];
  const regras = PROIBIDO.map((c) => `Disallow: ${c}`).join("\n");

  /* Os robôs de IA entram, e isso é DECISÃO, não esquecimento. Eles já
     passariam por omissão — mas "liberado por esquecimento" e "liberado por
     decisão" parecem iguais no arquivo, e no dia em que alguém colar aqui um
     robots.txt de modelo da internet (metade deles bloqueia esses robôs "por
     segurança"), a ótica sai das respostas sem ninguém perceber.

     Para uma loja local, ser citada em "onde comprar óculos em Caruaru?" vale
     tanto quanto uma posição na busca. Para sair, troque Allow por Disallow. */
  const IA = ["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot",
    "Claude-User", "PerplexityBot", "Google-Extended", "Applebot-Extended",
    "CCBot", "meta-externalagent"];

  return `${IA.map((b) => `User-agent: ${b}`).join("\n")}
Allow: /
${regras}

User-agent: *
Allow: /
${regras}

Sitemap: ${SITE}/sitemap.xml
`;
}

module.exports = { SITE, HOST, INDEXAVEL, DE_TRABALHO, robots, CABECALHO_ROBOS };
