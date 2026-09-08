#!/usr/bin/env bash
# Redeploys Aquascan on the VPS from main: pull, install, build the web, publish it, restart the services.
# Run as root on the VPS: /home/naumachy/naumachy/infra/vps/deploy.sh
set -euo pipefail
sudo -u naumachy bash -c 'cd ~/naumachy && git pull -q --ff-only && export PATH=$HOME/node-current/bin:$PATH && yarn install --immutable > /dev/null && yarn workspace @naumachy/aquascan-web build > /dev/null && git log --oneline -1'
rsync -a --delete /home/naumachy/naumachy/aquascan/web/dist/ /srv/naumachy/web/
install -m 644 /home/naumachy/naumachy/infra/vps/Caddyfile /etc/caddy/Caddyfile && caddy validate --config /etc/caddy/Caddyfile > /dev/null && systemctl reload caddy
install -m 644 /home/naumachy/naumachy/infra/vps/aquascan-api.service /home/naumachy/naumachy/infra/vps/aquascan-enrich.service /etc/systemd/system/ && systemctl daemon-reload
systemctl restart aquascan-api aquascan-enrich
sleep 5; systemctl is-active aquascan-api aquascan-enrich | tr '\n' ' '; echo; curl -s -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1/ -H 'Host: naumachy.xyz'
