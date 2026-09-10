# Subir o site das Óticas Cardoso

Para `oticascardoso.projetos.luizaugust.me`, porta **5184** — o endereço de
**aprovação**, para mandar ao cliente.

---

## Antes de tudo

### O DNS
No painel do `luizaugust.me`:

```
oticascardoso   A   <IP do servidor>
```

Confirme que propagou antes de mexer no servidor:

```bash
dig +short oticascardoso.projetos.luizaugust.me
```

### O Node precisa ser 22.5 ou maior
Este site usa `node:sqlite`, o SQLite nativo do Node — é o que permite ele
rodar com **zero dependências**, sem `npm install`. Antes do 22.5 esse módulo
não existe, e o serviço morre na primeira linha.

```bash
node --version
```

---

## 1. O código no servidor

Este projeto ainda **não é um repositório git**. Duas saídas:

**a) Criar o repositório** (recomendado, e necessário para ter deploy depois):

```bash
cd C:/Projects/SitesProjects/Oticas-Cardoso && git init -b main && git add -A
```

Depois commit, push, e no servidor `git clone`.

**b) Copiar direto**, para apresentar hoje:

```bash
rsync -av --exclude data/ --exclude .env C:/Projects/SitesProjects/Oticas-Cardoso/ deploy@<servidor>:/var/www/projetos/Oticas-Cardoso/
```

> **Exclua `data/`**: é o banco, e o do servidor tem o conteúdo que o cliente
> editar. Sobrescrevê-lo devolve tudo ao estado da sua máquina.

> **Copie como `deploy`, nunca como root.** Se o root virar dono, o serviço não
> consegue publicar. Se já aconteceu:
> `sudo chown -R deploy:deploy /var/www/projetos/Oticas-Cardoso`

---

## 2. O serviço

```bash
sudo cp operacao/oticascardoso.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now oticascardoso
curl -s http://127.0.0.1:5184/saude
```

O `/saude` tem de responder `{"ok":true,...}`. Se não:

```bash
journalctl -u oticascardoso -n 40 --no-pager
```

> **`ENOENT: mkdir` ou `226/NAMESPACE`** significa pasta de escrita faltando. A
> unidade tem `ProtectSystem=strict` e o processo **não consegue criá-la
> sozinho** — o pai está somente-leitura. O `criar-site.sh` cria todas no passo
> 3; para resolver na mão:
> `mkdir -p data loja produto checkout assets/js assets/img/uploads`

---

## 3. O vhost e o certificado

```bash
sudo ./criar-site.sh
```

Sem argumentos ele assume `oticascardoso.projetos.luizaugust.me` e a porta
`5184`. São sete passos, e ele para no primeiro que falhar: DNS, porta, pastas
de escrita, serviço, `.env`, vhost, certificado — e no fim confere que a home e
a loja respondem 200, que o `/src/` **não** vaza e que o canonical aponta para
o domínio certo.

> **A checagem de porta é a menos óbvia e a mais importante.** Se a 5184
> estivesse ocupada por outro site do servidor, o nginx repassaria para ele e
> você veria **a página de outro cliente** neste domínio — com 200, HTML válido
> e nenhum erro em lugar nenhum.

> **Enquanto o certificado não sair, a página não abre em navegador nenhum.** O
> domínio pai `projetos.luizaugust.me` tem HSTS com `includeSubDomains`: o
> navegador exige HTTPS antes de conhecer o site. É esperado. O certbot não se
> importa — valida por HTTP com cliente próprio.

Para conferir o vhost sem tocar em nada (roda em qualquer máquina, sem sudo):

```bash
OC_VHOST_ENSAIO=/tmp/vhost.conf ./criar-site.sh && cat /tmp/vhost.conf
```

> O modo de ensaio já pagou por si: pegou uma crase solta que fazia o shell
> executar `location` como comando no meio da geração do arquivo.

---

## 4. O que o endereço de aprovação garante

O link que você manda ao cliente **não é indexável**, e isso é automático — não
há caixa para marcar:

| | aprovação | produção |
|---|---|---|
| `robots.txt` | `Disallow: /` | libera, com `/admin/` e `/checkout/` fora |
| `X-Robots-Tag` | `noindex` em **toda** resposta, inclusive CSS e imagem | ausente |
| `sitemap.xml` | vazio | as 10 páginas |
| `canonical` | o endereço de aprovação | `oticascardoso.com` |
| HSTS | não (o domínio pai já anuncia) | sim, no server **e** em `/assets/` |
| bloco `www` | não existe | 301 para o domínio sem www |

O canonical se corrige **sozinho** na subida: se o HTML no disco não fala do
endereço em que o site está rodando, ele é republicado na hora. Trocar de
domínio é editar o `.env` e reiniciar.

Confira depois de subir:

```bash
curl -sI https://oticascardoso.projetos.luizaugust.me/ | grep -i x-robots-tag; curl -s https://oticascardoso.projetos.luizaugust.me/robots.txt
```

---

## 5. Antes de virar para `oticascardoso.com`

```bash
sudo ./criar-site.sh oticascardoso.com
```

O mesmo script, e ele muda o comportamento sozinho. Mas **três coisas precisam
estar resolvidas antes**, e o serviço avisa sobre elas a cada subida:

1. **As fotos dos produtos.** As oito são de banco de imagens, por hotlink do
   Unsplash. A loja vende um *"Aviador Clássico Dourado"* mostrando um óculos
   que ela não tem — o que chega na casa do cliente é outro produto. Isso gera
   devolução, não só desconfiança. E se o Unsplash bloquear o hotlink, a
   vitrine fica vazia.
2. **O WhatsApp** ainda é o número de exemplo (termina em 0000).
3. **O CNPJ** do rodapé ainda é o de exemplo.

---

## Se der errado

| Sintoma | Onde olhar |
|---|---|
| `ENOENT: mkdir` em laço de reinício | pasta de escrita faltando (passo 2) |
| `Cannot find module 'node:sqlite'` | Node abaixo de 22.5 |
| `5/TRAP` segundos depois de subir | alguém pôs `MemoryDenyWriteExecute` na unidade — tire |
| `is already bound to key` no nginx | `limit_req_zone` duplicada num vhost antigo; ela mora em `/etc/nginx/conf.d/` |
| painel diz "publicado" e a página não muda | falta `ReadWritePaths` para a pasta que o publish grava |
| trocou o WhatsApp e os clientes ligam para o velho | cache do `config.js` — o vhost dá 5 min a ele, confira se o bloco `location =` veio antes do `/assets/` |
| a página mostra o site de outro cliente | porta ocupada por vizinho: `ss -ltnp \| grep 5184` |
| `./criar-site.sh: Permission denied` | `chmod +x criar-site.sh` |
