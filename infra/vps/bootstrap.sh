#!/usr/bin/env bash
# naumachy.xyz VPS bootstrap: docker, caddy, firewall, a service user with node 22 via nvm
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q docker.io docker-compose-v2 caddy git ufw rsync curl jq postgresql-client
systemctl enable --now docker
id naumachy >/dev/null 2>&1 || useradd -m -s /bin/bash -G docker naumachy
mkdir -p /home/naumachy/.ssh && cp /root/.ssh/authorized_keys /home/naumachy/.ssh/ && chown -R naumachy:naumachy /home/naumachy/.ssh && chmod 700 /home/naumachy/.ssh && chmod 600 /home/naumachy/.ssh/authorized_keys
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null
sudo -u naumachy bash -lc 'export NVM_DIR=$HOME/.nvm; [ -d $NVM_DIR ] || (curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash >/dev/null); . $NVM_DIR/nvm.sh; nvm install 22 >/dev/null 2>&1; nvm alias default 22 >/dev/null; corepack enable >/dev/null 2>&1 || true; node --version; corepack yarn --version 2>/dev/null || true'
echo "docker $(docker --version | cut -d, -f1) | caddy $(caddy version | cut -d' ' -f1) | ufw: $(ufw status | head -1)"
