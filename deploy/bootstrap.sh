#!/usr/bin/env bash
# DocMind AI — instala e publica a demonstração num servidor Ubuntu/Debian com Docker.
#
# Uso (no servidor, dentro do repositório clonado):
#   sudo ./deploy/bootstrap.sh --domain demo.seu-dominio.com
#   sudo ./deploy/bootstrap.sh --sslip            # sem domínio: usa <ip-publico>.sslip.io
#   sudo ./deploy/bootstrap.sh --sslip --fake     # sem chave Gemini (respostas determinísticas)
# Opções:
#   --seed-email EMAIL   cria também uma conta de demonstração com os documentos fictícios
#                        (a senha é pedida no terminal e nunca é impressa)
#   --skip-docker        não instala o Docker (já instalado)
#
# A chave Gemini é lida da variável GEMINI_API_KEY ou pedida no terminal sem eco. Ela vai apenas
# para o .env do servidor (permissão 600), nunca para o git, imagens ou logs.
# Idempotente: um .env existente é preservado (apague-o para regenerar os segredos).
set -euo pipefail

cd "$(dirname "$0")/.."
REPO_DIR="$(pwd)"
COMPOSE=(docker compose -f docker-compose.prod.yml)

DOMAIN=""
USE_SSLIP=0
PROVIDER="gemini"
SEED_EMAIL=""
INSTALL_DOCKER=1

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mERRO: %s\033[0m\n' "$*" >&2; exit 1; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --domain) DOMAIN="${2:-}"; shift 2 ;;
    --sslip) USE_SSLIP=1; shift ;;
    --fake) PROVIDER="fake"; shift ;;
    --seed-email) SEED_EMAIL="${2:-}"; shift 2 ;;
    --skip-docker) INSTALL_DOCKER=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) die "opção desconhecida: $1 (use --help)" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "execute com sudo (instala pacotes e publica as portas 80/443)."
[[ -n "$DOMAIN" || $USE_SSLIP -eq 1 ]] || die "informe --domain <dominio> ou --sslip."
[[ -f docker-compose.prod.yml ]] || die "rode a partir do repositório do DocMind (docker-compose.prod.yml ausente)."
command -v apt-get >/dev/null || die "este script suporta Ubuntu/Debian (apt-get)."

# --------------------------------------------------------------------------- Docker
if [[ $INSTALL_DOCKER -eq 1 ]] && ! docker compose version >/dev/null 2>&1; then
  log "Instalando Docker Engine + Compose (repositório oficial da Docker)"
  # shellcheck disable=SC1091
  . /etc/os-release
  apt-get update -y
  apt-get install -y ca-certificates curl
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || die "Docker Compose indisponível."
command -v openssl >/dev/null || apt-get install -y openssl
command -v curl >/dev/null || apt-get install -y curl

# --------------------------------------------------------------------------- memória
# O build do frontend e a API usam ~2 GB no pico; em servidores pequenos, cria swap de 2 GB.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
if (( mem_kb < 3500000 && swap_kb == 0 )) && [[ ! -f /swapfile ]]; then
  log "Pouca memória ($((mem_kb / 1024)) MB) e sem swap: criando /swapfile de 2 GB"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --------------------------------------------------------------------------- firewall local
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  log "Liberando 80/tcp, 443/tcp e 443/udp no ufw"
  ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
fi

# --------------------------------------------------------------------------- endereço
if [[ $USE_SSLIP -eq 1 ]]; then
  log "Descobrindo o IP público para usar <ip>.sslip.io"
  PUBLIC_IP=$(curl -fsS --max-time 10 https://checkip.amazonaws.com | tr -d '[:space:]') \
    || die "não foi possível descobrir o IP público; use --domain."
  [[ $PUBLIC_IP =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "IP público inesperado: $PUBLIC_IP"
  DOMAIN="${PUBLIC_IP//./-}.sslip.io"
fi
[[ $DOMAIN =~ ^[A-Za-z0-9.-]+$ ]] || die "domínio inválido: $DOMAIN"
echo "Endereço público: https://$DOMAIN"

# --------------------------------------------------------------------------- .env
if [[ -f .env ]]; then
  log ".env já existe: preservado (segredos e chave atuais mantidos)"
  current_site=$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2- || true)
  [[ "$current_site" == "$DOMAIN" ]] || echo "Aviso: SITE_ADDRESS no .env é '$current_site' (não '$DOMAIN')."
else
  log "Gerando .env a partir de deploy/env.production.example"
  key="${GEMINI_API_KEY:-}"
  if [[ $PROVIDER == "gemini" && -z "$key" ]]; then
    [[ -t 0 ]] || die "defina GEMINI_API_KEY no ambiente ou rode de um terminal interativo (ou use --fake)."
    read -rsp "Cole a GEMINI_API_KEY (não aparece na tela): " key; echo
  fi
  if [[ $PROVIDER == "gemini" ]]; then
    [[ $key =~ ^[A-Za-z0-9_-]{20,}$ ]] || die "a chave informada não parece uma API key válida."
  fi
  umask 077
  # A chave entra pelo ambiente do awk, não como argumento (não aparece na lista de processos).
  sed \
    -e "s|__SITE_ADDRESS__|${DOMAIN}|g" \
    -e "s|__SECRET_KEY__|$(openssl rand -hex 32)|" \
    -e "s|__POSTGRES_PASSWORD__|$(openssl rand -hex 24)|" \
    -e "s|__MINIO_ROOT_PASSWORD__|$(openssl rand -hex 24)|" \
    -e "s|__PROVIDER__|${PROVIDER}|g" \
    deploy/env.production.example \
    | DOCMIND_KEY="$key" awk '{ gsub(/__GEMINI_API_KEY__/, ENVIRON["DOCMIND_KEY"]); print }' > .env
  unset key
  chmod 600 .env
  echo ".env criado (permissão 600). A chave não foi exibida."
fi

# --------------------------------------------------------------------------- subida
log "Construindo imagens e subindo a stack (alguns minutos na primeira vez)"
"${COMPOSE[@]}" up -d --build

log "Aguardando a API ficar saudável"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T api curl -fsS http://localhost:8000/api/v1/health >/dev/null 2>&1; then
    break
  fi
  sleep 5
done
"${COMPOSE[@]}" exec -T api curl -fsS http://localhost:8000/api/v1/health >/dev/null \
  || die "a API não respondeu; veja: ${COMPOSE[*]} logs api"

if [[ $PROVIDER == "gemini" ]]; then
  log "Validando a chave e os modelos Gemini (sem imprimir a chave)"
  "${COMPOSE[@]}" exec -T api python /scripts/check_gemini.py \
    || echo "Aviso: a verificação do Gemini falhou ou ficou pendente; veja a saída acima."
fi

log "Verificando o HTTPS público (o certificado pode levar até 1 minuto)"
https_ok=0
for _ in $(seq 1 24); do
  if curl -fsS --max-time 10 "https://${DOMAIN}/api/v1/instance" >/dev/null 2>&1; then
    https_ok=1; break
  fi
  sleep 5
done
if [[ $https_ok -eq 1 ]]; then
  echo "HTTPS ok: https://${DOMAIN}"
else
  echo "Aviso: https://${DOMAIN} ainda não responde. Confira se o DNS aponta para este servidor e se"
  echo "as portas 80 e 443 estão liberadas no firewall do provedor (security list / security group)."
  echo "Logs do Caddy: ${COMPOSE[*]} logs web"
fi

# --------------------------------------------------------------------------- conta de demo
if [[ -n "$SEED_EMAIL" ]]; then
  log "Criando a conta de demonstração $SEED_EMAIL com os documentos fictícios"
  [[ -t 0 ]] || die "--seed-email exige um terminal interativo para a senha."
  read -rsp "Senha da conta de demonstração (mín. 8 caracteres, não aparece na tela): " seed_pw; echo
  printf '%s\n' "$seed_pw" | "${COMPOSE[@]}" exec -T api python /scripts/seed_demo.py \
    --base http://api:8000 --email "$SEED_EMAIL" --password-stdin
  unset seed_pw
fi

log "Pronto"
cat <<EOF
Demo:        https://${DOMAIN}
Status:      ${COMPOSE[*]} ps
Logs:        ${COMPOSE[*]} logs -f api worker web
Backup:      sudo ./deploy/backup.sh   (agende no cron; ver docs/deploy.md)
Atualizar:   git pull && ${COMPOSE[*]} up -d --build
Diretório:   ${REPO_DIR}
EOF
