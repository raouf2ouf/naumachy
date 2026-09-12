#!/usr/bin/env bash
# Unseals the arena's secrets at boot: the sealed env (Ledger Key Ring, AES-256-GCM under the
# operator's Flex) is decrypted by this host's ring member into a tmpfs file the units read, so the
# clear text never touches the disk. Needs: wallet-cli, the member (session.yaml + the wrapped key
# in the Secret Service, see README), /etc/naumachy/ring.pass (the ring password) and
# /etc/naumachy/keyring.pass (the headless GNOME keyring's password), both owned by the service
# user, mode 600. Run as the service user.
#   infra/arena/unseal.sh [sealed] [out]
set -euo pipefail
SEALED=${1:-/home/naumachy/naumachy/infra/data/arena/arena.env.enc}
OUT=${2:-/run/naumachy/arena.env}
export PATH=/home/naumachy/node-current/bin:$PATH
mkdir -p "$(dirname "$OUT")"; umask 077
export SEALED OUT
dbus-run-session -- bash -c '
  eval "$(cat /etc/naumachy/keyring.pass | gnome-keyring-daemon --unlock --components=secrets 2>/dev/null)"
  WALLET_PASS="$(cat /etc/naumachy/ring.pass)" wallet-cli ring decrypt --key naumachy-arena -i "$SEALED" -o "$OUT" >/dev/null
'
chmod 600 "$OUT"; echo "unsealed $(wc -l < "$OUT") lines into $OUT"
