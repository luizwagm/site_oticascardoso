#!/usr/bin/env bash
# ==========================================================================
# ÓTICAS CARDOSO — criar o site no servidor
#
#   sudo ./criar-site.sh                      → oticascardoso.projetos.luizaugust.me
#   sudo ./criar-site.sh oticascardoso.com    → o domínio de verdade
#   sudo ./criar-site.sh <dominio> <porta> [email]
#
# Cria o vhost do nginx, emite o certificado e confere. Roda UMA vez por
# domínio; depois é o deploy que entrega versão nova.
#
# ---------------------------------------------------------------------------
# DUAS COISAS QUE MUDAM ENTRE O SUBDOMÍNIO E O DOMÍNIO DE VERDADE
#
# 1. NÃO EXISTE www NUM SUBDOMÍNIO. `www.oticascardoso.projetos.luizaugust.me`
#    não é endereço nenhum, e pedir certificado para ele faz o certbot falhar
#    por inteiro — derrubando junto o domínio que estava certo.
#
# 2. SOB `*.projetos.luizaugust.me` O NAVEGADOR RECUSA `http://`. O domínio pai
#    tem HSTS com includeSubDomains, então o navegador exige HTTPS ANTES de
#    conhecer o site. O certificado não é passo posterior: é pré-requisito para
#    a página abrir uma primeira vez.
#
#    O certbot NÃO é afetado — ele valida por HTTP com cliente próprio, que
#    ignora HSTS. Quem trava é você, testando no navegador antes da hora.
# ==========================================================================
set -uo pipefail

DOMINIO="${1:-oticascardoso.projetos.luizaugust.me}"
PORTA="${2:-5184}"
EMAIL="${3:-luizwagm@gmail.com}"
RAIZ="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
SERVICO="oticascardoso"

verde()   { printf "\033[1;32m%s\033[0m\n" "$1"; }
amarelo() { printf "\033[1;33m%s\033[0m\n" "$1"; }
vermelho(){ printf "\033[1;31m%s\033[0m\n" "$1"; }
azul()    { printf "\033[1;34m%s\033[0m\n" "$1"; }

# --------------------------------------------------------------------------
# MODO DE ENSAIO — usado para conferir o vhost, nunca na instalação
#
#   OC_VHOST_ENSAIO=/tmp/saida.conf ./criar-site.sh oticascardoso.com
#
# Gera o vhost naquele caminho e sai, sem tocar em nginx, certbot, DNS ou
# systemd, e SEM precisar de root. Existe porque o vhost é montado por heredoc,
# e heredoc quebra em SILÊNCIO: um `$` mal escapado não derruba o script — ele
# faz o bloco não ser escrito, e o defeito só aparece no servidor.
# --------------------------------------------------------------------------
ENSAIO="${OC_VHOST_ENSAIO:-}"

[ -n "$ENSAIO" ] || [ "$(id -u)" -eq 0 ] || { vermelho "Rode com sudo."; exit 1; }

PONTOS=$(echo "$DOMINIO" | tr -cd '.' | wc -c)
SUBDOMINIO=0
[ "$PONTOS" -ge 3 ] && SUBDOMINIO=1

echo
azul "Óticas Cardoso — instalação de $DOMINIO na porta $PORTA"
echo

# ======================================================================
# 1/7  O DNS
# ======================================================================
echo "1/7  Conferindo o DNS"

if [ -n "$ENSAIO" ]; then
  echo "     [ensaio] pulando DNS, porta, pastas e serviço"
  DOMINIOS="-d $DOMINIO"
  [ "$SUBDOMINIO" -eq 0 ] && DOMINIOS="$DOMINIOS -d www.$DOMINIO"
fi

if [ -z "$ENSAIO" ]; then

MEUS_IPS=$(
  { ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}';
    ip -6 addr show scope global 2>/dev/null | grep -oP '(?<=inet6\s)[0-9a-f:]+';
    curl -s --max-time 5 https://api.ipify.org 2>/dev/null;
    curl -s --max-time 5 https://api64.ipify.org 2>/dev/null; } | sort -u
)

resolve() { dig +short "$1" "$2" 2>/dev/null | grep -v '\.$' | head -1; }
daqui()   { [ -n "$1" ] && echo "$MEUS_IPS" | grep -qxF "$1"; }

A=$(resolve "$DOMINIO" A)
AAAA=$(resolve "$DOMINIO" AAAA)

if daqui "$A" || daqui "$AAAA"; then
  verde "     $DOMINIO -> ${A:-$AAAA}  (é este servidor)"
else
  vermelho "     $DOMINIO -> ${A:-${AAAA:-nada}}"
  vermelho "     não aponta para este servidor. O certbot vai falhar."
  echo "     IPs daqui:"; echo "$MEUS_IPS" | sed 's/^/       /'
  exit 1
fi

DOMINIOS="-d $DOMINIO"
if [ "$SUBDOMINIO" -eq 0 ]; then
  WA=$(resolve "www.$DOMINIO" A); WAAAA=$(resolve "www.$DOMINIO" AAAA)
  if daqui "$WA" || daqui "$WAAAA"; then
    DOMINIOS="$DOMINIOS -d www.$DOMINIO"
    verde "     www.$DOMINIO -> ${WA:-$WAAAA}  (entra no certificado)"
  else
    amarelo "     www.$DOMINIO não resolve para cá — fica de fora do certificado"
  fi
fi

# ======================================================================
# 2/7  A PORTA
#
# O servidor tem sites que não estão na máquina de quem desenvolve. E o modo de
# falhar é o pior possível: o nginx repassa para 127.0.0.1:<porta> e, se quem
# atende ali for OUTRO site, o visitante recebe a resposta DO VIZINHO — com
# 200, HTML válido e nenhum erro em lugar nenhum.
# ======================================================================
echo "2/7  Conferindo a porta $PORTA"

# --------------------------------------------------------------------------
# QUEM FILTRA É O ss, NÃO UM grep SOBRE O ENDEREÇO
#
# A primeira versão fazia `ss -ltnp | grep` procurando três formatos de
# endereço: `127.0.0.1:PORTA`, `0.0.0.0:PORTA` e `:::PORTA`. Um processo que
# escuta em todas as interfaces aparece como `*:PORTA` ou `[::]:PORTA` — um
# quarto e um quinto formato. O grep não achou, o script disse "porta livre"
# com a porta ocupada, e o serviço morreu em seguida com EADDRINUSE.
#
# `ss "sport = :PORTA"` pede ao próprio ss para filtrar pela porta, em
# qualquer formato de endereço que ele use. Não há o que adivinhar.
# --------------------------------------------------------------------------
OCUPANTES=$(ss -H -ltnp "sport = :$PORTA" 2>/dev/null || true)

if [ -z "$OCUPANTES" ]; then
  verde "     porta $PORTA livre"
else
  # --------------------------------------------------------------------------
  # E NÃO BASTA SABER QUE ESTÁ OCUPADA: É PRECISO SABER POR QUEM
  #
  # São três casos, e cada um pede uma coisa diferente:
  #   · o próprio serviço     → reinstalação, segue normal
  #   · ESTE site, mas fora   → um `node server.js` rodado à mão; o serviço
  #     do systemd                entra em laço de EADDRINUSE, e o /saude
  #                               responde do processo errado, parecendo que
  #                               está tudo bem. Foi exatamente o que houve.
  #   · outro site            → vizinho; NUNCA encerrar, trocar de porta
  #
  # A pasta de trabalho do processo (/proc/PID/cwd) é o que separa o segundo
  # caso do terceiro. O nome do processo não serve: todos os sites do servidor
  # são `node server.js`, com o mesmo usuário.
  # --------------------------------------------------------------------------
  PID_SERVICO=$(systemctl show -p MainPID --value "$SERVICO.service" 2>/dev/null || echo 0)

  for PID in $(echo "$OCUPANTES" | grep -oP 'pid=\K[0-9]+' | sort -u); do
    PASTA=$(readlink "/proc/$PID/cwd" 2>/dev/null || echo "?")
    QUANDO=$(ps -o lstart= -p "$PID" 2>/dev/null | sed 's/^ *//')

    if [ "$PID" = "$PID_SERVICO" ]; then
      verde "     porta $PORTA é do $SERVICO.service (PID $PID) — reinstalação, tudo bem"

    elif [ "$PASTA" = "$RAIZ" ]; then
      vermelho "     a porta $PORTA está com ESTE MESMO site, mas rodando FORA do systemd:"
      echo "       PID $PID, iniciado em $QUANDO, pasta $PASTA"
      echo
      echo "     Provavelmente um 'node server.js' rodado à mão. Enquanto ele existir,"
      echo "     o serviço não consegue abrir a porta e fica reiniciando a cada 3s —"
      echo "     e o /saude responde deste processo, parecendo que está tudo bem."
      echo
      echo "     Encerre-o e rode de novo:"
      echo "       sudo kill $PID && sudo systemctl restart $SERVICO && sudo ./criar-site.sh"
      exit 1

    else
      vermelho "     a porta $PORTA está ocupada por OUTRO site:"
      echo "       PID $PID, pasta $PASTA"
      vermelho "     se eu seguisse, o nginx repassaria para ele e você veria a página"
      vermelho "     DELE neste domínio, com 200 e sem erro. NÃO encerre esse processo."
      echo
      echo "     Escolha uma porta livre e passe como 2º argumento:"
      echo "       ss -H -ltn | grep -oP ':\\K51[0-9]{2}(?= )' | sort -u"
      exit 1
    fi
  done
fi

# ======================================================================
# 3/7  AS PASTAS QUE O SITE PRECISA GRAVAR
#
# Este site ESCREVE as próprias páginas ao publicar. A unidade tem
# ProtectSystem=strict e libera só o que está em ReadWritePaths — e o `-` na
# frente de cada caminho significa "ignore se não existir". Pasta que não
# existe NÃO é montada como gravável, e o publish falha em silêncio: o painel
# diz "publicado" e a página não muda.
#
# Pior: se `data/` faltar, o serviço nem sobe — morre com `ENOENT: mkdir` num
# laço de reinício a cada 3 segundos.
# ======================================================================
echo "3/7  Conferindo as pastas de escrita"

DONO_UNIDADE=$(systemctl show -p User --value "$SERVICO.service" 2>/dev/null)
DONO_UNIDADE="${DONO_UNIDADE:-deploy}"
CRIEI=0
for PASTA in data loja produto checkout assets/js assets/img/uploads; do
  if [ ! -d "$RAIZ/$PASTA" ]; then
    mkdir -p "$RAIZ/$PASTA"
    chown "$DONO_UNIDADE:$DONO_UNIDADE" "$RAIZ/$PASTA" 2>/dev/null || true
    amarelo "     criei $PASTA/"
    CRIEI=$((CRIEI + 1))
  fi
done
[ "$CRIEI" -eq 0 ] && verde "     todas as pastas de escrita já existem" \
  || amarelo "     $CRIEI pasta(s) criadas (dono: $DONO_UNIDADE)"

# ======================================================================
# 4/7  O SERVIÇO
# ======================================================================
echo "4/7  Conferindo o serviço"

# `systemctl show -p LoadState --value` e não `list-unit-files | grep`: a
# listagem é uma tabela formatada para a largura do terminal, e o systemd
# TRUNCA nomes longos com reticências. O grep não acha, e o script manda
# instalar o que já está instalado.
ESTADO=$(systemctl show -p LoadState --value "$SERVICO.service" 2>/dev/null || echo "erro")

if [ "$ESTADO" = "masked" ]; then
  vermelho "     $SERVICO.service está MASCARADO."
  echo "       sudo systemctl unmask $SERVICO"
  exit 1
fi
if [ "$ESTADO" != "loaded" ]; then
  amarelo "     $SERVICO.service ainda não existe (LoadState=$ESTADO)."
  echo "     Instale antes de continuar:"
  echo "       sudo cp $RAIZ/operacao/$SERVICO.service /etc/systemd/system/"
  echo "       sudo systemctl daemon-reload"
  echo "       sudo systemctl enable --now $SERVICO"
  exit 1
fi
verde "     $SERVICO.service instalado"

if ! systemctl is-active --quiet "$SERVICO.service"; then
  amarelo "     não está de pé — tentando iniciar"
  systemctl start "$SERVICO.service" 2>/dev/null || true
  sleep 2
fi

if ! systemctl is-active --quiet "$SERVICO.service"; then
  vermelho "     o serviço NÃO sobe. Últimas linhas do journal:"
  journalctl -u "$SERVICO" -n 15 --no-pager 2>/dev/null | sed 's/^/       /'
  echo

  # Quando o journal já diz a causa, dizê-la primeiro. A lista genérica abaixo
  # mandou procurar pasta e versão do Node num erro que era porta ocupada.
  if journalctl -u "$SERVICO" -n 40 --no-pager 2>/dev/null | grep -q EADDRINUSE; then
    vermelho "     CAUSA: a porta $PORTA já está em uso (EADDRINUSE)."
    echo "     Veja quem é — e só encerre se a pasta for $RAIZ:"
    echo "       sudo ss -ltnp 'sport = :$PORTA'"
    echo "       sudo readlink /proc/<PID>/cwd"
    exit 1
  fi

  echo "     As causas, na ordem em que costumam acontecer:"
  echo "       1. pasta de escrita faltando — 'ENOENT: mkdir' ou '226/NAMESPACE'"
  echo "          (o passo 3 já as cria; confira o dono com: ls -ld $RAIZ/data)"
  echo "       2. Node antigo — este site usa node:sqlite, que exige Node 22.5+"
  echo "          aqui: $(node --version 2>/dev/null || echo 'node não encontrado')"
  echo "       3. o dono do código não é $DONO_UNIDADE:"
  echo "          sudo chown -R $DONO_UNIDADE:$DONO_UNIDADE $RAIZ"
  exit 1
fi

SAUDE=$(curl -s --max-time 5 "http://127.0.0.1:$PORTA/saude" || echo "")
if echo "$SAUDE" | grep -q '"ok":true'; then
  verde "     $SERVICO responde em 127.0.0.1:$PORTA"
  echo "     $SAUDE" | sed 's/^/       /'
else
  vermelho "     o serviço está ativo, mas 127.0.0.1:$PORTA não respondeu /saude:"
  echo "       ${SAUDE:-(vazio)}"
  vermelho "     confira: journalctl -u $SERVICO -n 40 --no-pager"
  exit 1
fi

# ======================================================================
# 5/7  O ENDEREÇO PÚBLICO NO .env
#
# O canonical, o JSON-LD e o sitemap saem daqui. Até a versão 1.0.0 o domínio
# estava ESCRITO no código: subir a versão de aprovação faria o Google indexar
# a demonstração E tratá-la como a versão oficial do domínio final, por causa
# do canonical.
# ======================================================================
echo "5/7  Gravando o endereço no .env"

ENV="$RAIZ/.env"
touch "$ENV"; chmod 600 "$ENV"
if grep -q '^OC_SITE=' "$ENV" 2>/dev/null; then
  sed -i "s|^OC_SITE=.*|OC_SITE=https://$DOMINIO|" "$ENV"
else
  echo "OC_SITE=https://$DOMINIO" >> "$ENV"
fi
chown "$DONO_UNIDADE:$DONO_UNIDADE" "$ENV" 2>/dev/null || true
verde "     OC_SITE=https://$DOMINIO"

if [ "$SUBDOMINIO" -eq 1 ]; then
  amarelo "     endereço de aprovação: sai FORA do índice do Google"
  amarelo "     (robots.txt bloqueia, X-Robots-Tag em toda resposta, sitemap vazio)"
else
  echo
  amarelo "     ATENÇÃO: domínio público. Antes de divulgar, confira no painel:"
  amarelo "       · as FOTOS DOS PRODUTOS — as de demonstração são de banco de"
  amarelo "         imagens, e o cliente receberia um óculos diferente do da foto"
  amarelo "       · o WhatsApp (o de exemplo termina em 0000)"
  amarelo "       · o CNPJ do rodapé"
  echo
fi

fi   # fim do trecho que o ensaio pula (passos 1 a 5)

# ======================================================================
# 6/7  O VHOST
# ======================================================================
echo "6/7  Criando o vhost"

# HSTS só no domínio próprio: sob *.projetos.luizaugust.me o pai já anuncia com
# includeSubDomains. SEM `preload`, que é praticamente irreversível e vale para
# o domínio inteiro — decisão do dono, não de um script de instalação.
#
# ARMADILHA DO NGINX: `add_header` dentro de um `location` APAGA os add_header
# do server. Por isso o cabeçalho é repetido nos blocos de /assets/ — sem a
# repetição, o CSS e as imagens sairiam sem HSTS, e `curl -I` na home aprovaria
# assim mesmo, porque a home não passa por aquele location.
HSTS_SERVER=""
HSTS_ASSETS=""
if [ "$SUBDOMINIO" -eq 0 ]; then
  HSTS_SERVER='    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
  HSTS_ASSETS='        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
fi

# --------------------------------------------------------------------------
# A ZONA DO LIMITADOR — arquivo próprio, uma vez só
#
# `limit_req_zone` pertence ao contexto http e o nome da zona é GLOBAL. Dentro
# do vhost, cada domínio do mesmo site declara a mesma zona e o nginx recusa
# TUDO com "is already bound to key" — erro que só aparece quando existe o
# segundo vhost, ou seja, na virada para o domínio de verdade.
# --------------------------------------------------------------------------
if [ -z "$ENSAIO" ]; then
  cat > /etc/nginx/conf.d/oticascardoso-limites.conf <<'LIMITES'
# Gerado por criar-site.sh — Óticas Cardoso
# Freio de borda do login do painel. Vale para TODOS os vhosts deste site.
limit_req_zone $binary_remote_addr zone=oc_login:10m rate=20r/m;
LIMITES
  verde "     zona do limitador em /etc/nginx/conf.d/oticascardoso-limites.conf"

  for VELHO in /etc/nginx/sites-available/*; do
    [ -f "$VELHO" ] || continue
    [ "$VELHO" = "/etc/nginx/sites-available/$DOMINIO" ] && continue
    if grep -q 'zone=oc_login' "$VELHO" 2>/dev/null; then
      cp "$VELHO" "$VELHO.bak-limites-$(date +%Y-%m-%d-%H%M%S)"
      sed -i '/limit_req_zone .*zone=oc_login/d' "$VELHO"
      amarelo "     tirei a zona duplicada de $(basename "$VELHO") (cópia .bak guardada)"
    fi
  done
fi

ARQ="/etc/nginx/sites-available/$DOMINIO"
[ -n "$ENSAIO" ] && ARQ="$ENSAIO"
[ -f "$ARQ" ] && { cp "$ARQ" "$ARQ.bak-$(date +%F-%H%M%S)"; amarelo "     já existia — guardei uma cópia .bak"; }

SERVIDORES="$DOMINIO"
BLOCO_WWW=""
if [ "$SUBDOMINIO" -eq 0 ] && echo "$DOMINIOS" | grep -q " -d www.$DOMINIO"; then
  BLOCO_WWW=$(cat <<WWW
server {
    listen 80;
    listen [::]:80;
    server_name www.$DOMINIO;

    # O certbot valida o www por HTTP e precisa alcancar isto ANTES do
    # redirecionamento — senao o certificado do www nunca sai.
    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }

    # 301 e nao 302: o permanente e o que transfere a forca do endereco antigo
    # para o novo. O temporario mantem os dois no indice para sempre.
    location / { return 301 https://$DOMINIO\$request_uri; }
}
WWW
)
  verde "     www.$DOMINIO vai redirecionar para $DOMINIO (301)"
fi

cat > "$ARQ" <<NGINX
# Gerado por criar-site.sh — Óticas Cardoso
# Confira com \`nginx -T\`, não com \`nginx -t\`: o -t aprova bloco que o nginx
# nem carregou (link quebrado, arquivo fora do include).

# A zona \`oc_login\` NÃO fica aqui: é do contexto http e o nome é global. Com
# dois vhosts do mesmo site (o de aprovação e o de produção, durante a virada)
# o nginx recusaria a configuração inteira com "is already bound to key".

$BLOCO_WWW
server {
    listen 80;
    listen [::]:80;
    server_name $SERVIDORES;

    location ^~ /.well-known/acme-challenge/ { root /var/www/html; }

    access_log /var/log/nginx/$DOMINIO.access.log;
    error_log  /var/log/nginx/$DOMINIO.error.log;

    # O site em si não recebe envio de arquivo. O teto sobe SÓ no /api/, que é
    # por onde o painel manda as fotos dos produtos.
    client_max_body_size 1m;

$HSTS_SERVER

    # ------------------------------------------------------------------
    # COMPRESSÃO
    #
    # O nginx só comprime text/html por padrão. A home tem 30 KB e a loja 19;
    # com gzip caem para menos de 7. A falta disto foi o gargalo de TTFB em
    # outro site do parque.
    #
    # WebP, PNG e JPEG NÃO entram: já são comprimidos, e passar gzip por cima
    # gasta CPU para às vezes aumentar o arquivo.
    # ------------------------------------------------------------------
    gzip on;
    gzip_vary on;
    gzip_min_length 512;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_types text/plain text/css text/javascript application/javascript
               application/json application/xml image/svg+xml
               application/manifest+json;

    # ==================================================================
    # O config.js NÃO PODE TER CACHE LONGO
    #
    # Ele parece um arquivo estático, mas NÃO é: o publish() reescreve o
    # número do WhatsApp dentro dele toda vez que o painel publica.
    #
    # Com os 7 dias do bloco de baixo, o dono trocaria o telefone no painel,
    # veria a mudança na tela dele (que recarregou) e os clientes
    # continuariam ligando para o número velho por uma semana — sem nenhum
    # erro em lugar nenhum. Este bloco vem ANTES do /assets/ de propósito:
    # no nginx, um "location =" exato vence o prefixo.
    #
    # (E as aspas aqui não são estilo: dentro deste heredoc uma crase EXECUTA
    #  o que estiver entre elas. A primeira versão escrevia a palavra com
    #  crases e o shell tentou rodar "location" como comando. O modo de ensaio
    #  pegou — que é exatamente para isso que ele existe.)
    # ==================================================================
    location = /assets/js/config.js {
        alias $RAIZ/assets/js/config.js;
        expires 5m;
        add_header Cache-Control "public, must-revalidate" always;
$HSTS_ASSETS
        access_log off;
    }

    # ------------------------------------------------------------------
    # O RESTO DOS ESTÁTICOS
    #
    # Servidos do disco, sem acordar o Node. Uma semana é seguro para CSS,
    # JS e imagens porque eles só mudam quando o código muda — e aí o deploy
    # é quem trata.
    # ------------------------------------------------------------------
    location ^~ /assets/ {
        alias $RAIZ/assets/;
        expires 7d;
        add_header Cache-Control "public, must-revalidate" always;
$HSTS_ASSETS
        access_log off;
        try_files \$uri =404;
    }

    # O painel manda fotos em base64 pelo corpo do pedido — o teto de 1m da
    # home recusaria uma foto de celular com "413 Request Entity Too Large".
    location ^~ /api/ {
        client_max_body_size 26m;
        proxy_pass http://127.0.0.1:$PORTA;
        include /etc/nginx/proxy_oticascardoso.conf;
    }

    # Freio de borda do login: o pedido nem acorda o processo.
    location = /api/login {
        limit_req zone=oc_login burst=5 nodelay;
        client_max_body_size 8k;
        proxy_pass http://127.0.0.1:$PORTA;
        include /etc/nginx/proxy_oticascardoso.conf;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORTA;
        include /etc/nginx/proxy_oticascardoso.conf;
    }
}
NGINX

# O ENSAIO TERMINA AQUI. Daqui para baixo o script mexe em nginx, systemd e
# certbot — nada disso pertence a uma conferência, e tudo isso exige root.
if [ -n "$ENSAIO" ]; then
  verde "[ensaio] vhost escrito em $ARQ"
  exit 0
fi

# O X-Forwarded-For usa \$proxy_add_x_forwarded_for, que ACRESCENTA o IP real
# ao FIM da lista — por isso a aplicação lê o ÚLTIMO item. O primeiro é texto
# escrito pelo cliente, e ler dali já desligou a trava de força bruta em quatro
# servidores do parque.
cat > /etc/nginx/proxy_oticascardoso.conf <<'PROXY'
proxy_http_version 1.1;
proxy_set_header Host              $host;
proxy_set_header X-Real-IP         $remote_addr;
proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_connect_timeout 10s;
proxy_read_timeout    60s;
PROXY

ln -sf "$ARQ" "/etc/nginx/sites-enabled/$DOMINIO"
if ! nginx -t 2>&1 | sed 's/^/     /'; then
  vermelho "     configuração inválida — nada foi recarregado"
  exit 1
fi
systemctl reload nginx
verde "     vhost ativo em HTTP"

# ======================================================================
# 7/7  O CERTIFICADO, E A CONFERÊNCIA
# ======================================================================
echo "7/7  Emitindo o certificado"
if [ "$SUBDOMINIO" -eq 1 ]; then
  echo "     (sob *.projetos.luizaugust.me o navegador recusa http:// por HSTS —"
  echo "      até aqui a página não abre em navegador nenhum. É esperado.)"
fi
# shellcheck disable=SC2086
if certbot --nginx $DOMINIOS --redirect --agree-tos --no-eff-email -m "$EMAIL" --non-interactive; then
  verde "     certificado emitido e HTTPS ativo"
else
  vermelho "     o certbot falhou — veja /var/log/letsencrypt/letsencrypt.log"
  [ "$SUBDOMINIO" -eq 1 ] && vermelho "     sem certificado, este endereço NÃO abre no navegador (HSTS)."
  exit 1
fi

# O OC_SITE é lido na SUBIDA, e é na subida que o site republica as páginas com
# o canonical certo. Sem reiniciar, o canonical continuaria o antigo — e
# canonical errado é o que faz o Google indexar o endereço que não é.
systemctl restart "$SERVICO.service"
sleep 3

HTTPS=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMINIO/" || echo 000)
LOJA=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMINIO/loja/" || echo 000)
CANON=$(curl -s "https://$DOMINIO/" | grep -o 'rel="canonical" href="[^"]*"' | head -1 | sed 's/.*href="//;s/"//')
ROBOTS=$(curl -s "https://$DOMINIO/robots.txt" | grep -v '^#' | head -3 | tr '\n' ' ')
TAG=$(curl -s -I "https://$DOMINIO/" | grep -i 'x-robots-tag' | tr -d '\r')
VAZA=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMINIO/src/loja.html" || echo 000)

echo
echo "     https://$DOMINIO        -> $HTTPS"
echo "     /loja/                              -> $LOJA"
echo "     /src/loja.html (não pode vazar)     -> $VAZA"
echo "     canonical: ${CANON:-(nenhum)}"
echo "     robots.txt: $ROBOTS"
[ -n "$TAG" ] && echo "     $TAG"

certbot renew --dry-run >/dev/null 2>&1 \
  && verde "     renovação automática testada" \
  || amarelo "     o teste de renovação falhou — rode 'certbot renew --dry-run'"

echo
FALHOU=0
[ "$HTTPS" = "200" ] || { vermelho "  ✖ a home não respondeu 200"; FALHOU=1; }
[ "$LOJA"  = "200" ] || { vermelho "  ✖ a loja não respondeu 200"; FALHOU=1; }
[ "$VAZA"  = "404" ] || { vermelho "  ✖ /src/ ainda está sendo servido ($VAZA)"; FALHOU=1; }
case "$CANON" in
  "https://$DOMINIO"*) ;;
  *) vermelho "  ✖ o canonical não aponta para https://$DOMINIO"; FALHOU=1 ;;
esac

if [ "$FALHOU" -eq 0 ]; then
  verde "Pronto: https://$DOMINIO"
  if [ "$SUBDOMINIO" -eq 1 ]; then
    echo "Endereço de aprovação — fora do índice do Google, como deve ser."
    echo "Pode mandar este link para o cliente."
  fi
else
  vermelho "Subiu, mas com pendências. Confira os itens acima."
fi
echo
