# Histórico de versões — Óticas Cardoso

O número do meio sobe quando entra funcionalidade; o último, quando entra
correção. O primeiro não muda.

## 1.1.2 — 10/09/2026

**Corrigido — achados na primeira instalação no servidor**

- **O `criar-site.sh` disse "porta 5184 livre" com a porta ocupada.** Ele
  fazia `ss | grep` procurando três formatos de endereço (`127.0.0.1:`,
  `0.0.0.0:`, `:::`). Um processo que escuta em todas as interfaces aparece
  como `*:5184` ou `[::]:5184` — nenhum dos três. Agora quem filtra é o
  próprio `ss` (`sport = :5184`), em qualquer formato.

- **E ele passou a dizer QUEM está na porta**, pela pasta do processo
  (`/proc/PID/cwd`) — o nome não serve, porque todos os sites do servidor são
  `node server.js` com o mesmo usuário. Três casos: o próprio serviço (segue),
  este mesmo site rodando fora do systemd (manda encerrar o PID), ou um vizinho
  (manda trocar de porta e **não** encerrar).

  O caso do meio foi o que aconteceu: um `node server.js` rodado à mão
  segurava a porta, o serviço entrava em laço de `EADDRINUSE`, e o `/saude`
  respondia do processo errado — parecendo que estava tudo bem.

- **Quando o journal já diz a causa, o script diz primeiro.** A lista genérica
  mandou procurar pasta faltando e versão do Node num erro que era porta.

- **O site escutava em todas as interfaces.** `listen(PORT)` sem endereço fazia
  o Node responder direto em `http://<IP-do-servidor>:5184` — por fora do
  nginx, sem TLS e sem os cabeçalhos dele. O login do painel trafegaria por
  ali em texto puro. Agora escuta só em `127.0.0.1`, e a unit declara `HOST`.

## 1.1.1 — 09/09/2026

**Corrigido — dois defeitos da própria conferência, achados testando a VIRADA**

Os dois só aparecem no dia em que o site sai da aprovação para o domínio
público — o pior momento possível para descobrir.

- **A home entrava em produção com `noindex`.** A regra da meta robots
  preservava o valor quando ele já dizia "noindex", pensando no checkout. Mas
  depois de rodar em aprovação TODAS as páginas ficam com noindex no disco:
  ao virar, a regra via "já é noindex" e preservava. O site entraria no ar
  invisível para o Google, sem erro em lugar nenhum.

  Agora quem chama diz se a página é fora do índice por natureza, e o valor
  anterior não influencia nada. **Estado antigo nunca deve decidir estado
  novo.**

- **A conferência de subida olhava uma página e concluia pelas dez.** Ela lia
  só o `index.html`; a loja, o checkout e os oito produtos continuavam com o
  canonical do domínio errado sem nenhum aviso. Agora confere três páginas.

- **E ela só olhava um sentido**: reclamava quando o noindex FALTAVA, nunca
  quando ele SOBRAVA. Uma conferência que pergunta metade aprova metade dos
  casos por omissão.

- As páginas geradas a partir dos modelos de `src/` (loja, produto, checkout)
  também traziam o domínio fixo no canonical, e passavam intactas. Agora
  passam pelo mesmo tratamento do index.

## 1.1.0 — 09/09/2026

O site passou a ter como subir, e parou de vazar o próprio código.

**Corrigido — o vazamento**

- **`/src/loja.html`, `/src/produto.html` e `/src/checkout.html` eram servidos
  a quem pedisse.** São os modelos internos do gerador, com os marcadores que
  mostram como o site é montado por dentro.

  A causa não era esquecimento: o servidor autorizava por lista de
  **proibidos** (`/data` e `/server.js`) e servia todo o resto da pasta. Esse
  desenho falha sempre para o lado pior — tudo que ninguém lembrar de proibir
  vaza. Um `.env` posto na raiz amanhã, um `backup.sql`, um `notas.txt`:
  nenhum estava na lista, todos seriam servidos com 200.

  Agora vale o contrário: **nada é servido, exceto o que está declarado**.
  Provado com arquivos de teste na raiz (404), com travessia por dentro de
  pasta permitida (`/assets/../server.js`, 404) e conferindo que as 12 rotas
  públicas continuam em 200.

**Corrigido — o endereço, que impedia apresentar com segurança**

- **`https://oticascardoso.com` estava ESCRITO no código**, em quatro lugares:
  o JSON-LD do `server.js`, o `const SITE` do `publish()`, o `index.html` e o
  `robots.txt` — que ainda por cima dizia `Allow: /`.

  Subir a versão de aprovação assim produziria o pior resultado possível: o
  Google indexaria a demonstração — com fotos de banco de imagens e preços de
  exemplo — **e** a trataria como a versão oficial do domínio final, por causa
  do canonical. Tirar do índice depois leva semanas, e o link de aprovação
  circula no WhatsApp.

  Agora o endereço vem de `OC_SITE`, e qualquer `.projetos.luizaugust.me` sai
  automaticamente fora do índice: `robots.txt` gerado com `Disallow: /`,
  `X-Robots-Tag` em **toda** resposta (inclusive CSS e imagem) e sitemap
  vazio. Provado nos dois sentidos.

- **O canonical se corrige sozinho na subida.** As páginas deste site são
  arquivos no disco, reescritos só quando alguém clica em "Publicar". Trocar o
  `.env` e reiniciar não bastaria — o HTML continuaria com o endereço antigo, e
  nada na tela denunciaria. Agora o servidor confere e republica.

- O `robots.txt` estático foi **removido do disco**: ele é gerado pela rota, e
  um arquivo morto que contradiz o que o site responde é armadilha — alguém
  vai lê-lo um dia e acreditar nele.

**Entrou**

- **`criar-site.sh`** — vhost, certificado e conferência em sete passos, com
  modo de ensaio (`OC_VHOST_ENSAIO`) que gera o vhost sem root e sem tocar em
  nada. Confere a porta com `ss` antes de criar o vhost, cria as seis pastas
  de escrita que a unidade exige, e no fim valida que `/src/` não vaza e que o
  canonical aponta para o domínio certo.
- **`operacao/oticascardoso.service`** — `ProtectSystem=strict` com uma lista
  de escrita comprida de propósito: este site reescreve as próprias páginas ao
  publicar, e liberar a raiz inteira deixaria o processo reescrever o
  `server.js`. `server.js`, `lib/` e `src/` ficam somente-leitura.
- **`/saude`** — sem ela nenhum deploy ou monitoramento consegue saber se o
  site subiu.
- **`package.json`** com `engines: node >=22.5` (o `node:sqlite` não existe
  antes disso) e a versão, que o `/saude` reporta.
- **`SUBIR.md`** e este histórico.
- A porta passou a vir do ambiente — sem isso a unidade não consegue defini-la
  e as provas não têm como subir sem conversar com o site que já está no ar.

**No vhost, uma armadilha que valia o achado**

- **O `config.js` não pode ter cache longo.** Ele parece estático, mas o
  `publish()` reescreve o número do WhatsApp dentro dele. Com os 7 dias dos
  outros estáticos, o dono trocaria o telefone no painel, veria a mudança na
  tela dele e os clientes continuariam ligando para o número velho por uma
  semana — sem erro em lugar nenhum. Ele tem bloco próprio, com 5 minutos, e
  vem **antes** do `/assets/` porque no nginx o `location =` exato vence o
  prefixo.

**Pendências que impedem o domínio público** (o serviço avisa a cada subida)

1. As 8 fotos de produto são de banco de imagens, por hotlink do Unsplash.
2. O WhatsApp é o número de exemplo.
3. O CNPJ do rodapé é o de exemplo.
