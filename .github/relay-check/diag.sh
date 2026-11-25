#!/bin/bash
# Ask Open Relay directly, with coturn's own test client, whether it takes the website's kind of login.
set +e
H=staticauth.openrelay.metered.ca
echo "== DNS"; for h in $H openrelay.metered.ca global.relay.metered.ca eu-0.turn.peerjs.com; do echo "$h: $(dig +short A $h | tr '\n' ' ')"; done
echo "== TCP reachability"; for p in 80 443 3478; do timeout 6 bash -c "echo > /dev/tcp/$H/$p" && echo "$H:$p open" || echo "$H:$p closed"; done
sudo apt-get -qq update >/dev/null 2>&1; sudo apt-get -qq install -y coturn >/dev/null 2>&1; which turnutils_uclient || { echo "no turnutils_uclient"; exit 0; }
EXP=$(( $(date +%s) + 86400 )); U="$EXP:kittycity"; P=$(printf '%s' "$U" | openssl dgst -sha1 -hmac openrelayprojectsecret -binary | base64)
try() { echo "== $1"; shift; timeout 25 turnutils_uclient -n 1 -m 1 -l 32 -e 8.8.8.8 "$@" 2>&1 | grep -Ei 'allocat|401|403|error|success|fail|realm|relay|stale|tot_send|timeout' | head -8; echo "(exit ${PIPESTATUS[0]})"; }
try "REST login, UDP 80" -u "$U" -w "$P" -p 80 $H
try "REST login, UDP 443" -u "$U" -w "$P" -p 443 $H
try "REST login, TCP 80" -t -u "$U" -w "$P" -p 80 $H
try "REST login, TCP 443" -t -u "$U" -w "$P" -p 443 $H
try "REST login, TLS 443" -t -S -u "$U" -w "$P" -p 443 $H
try "shared secret option, UDP 80" -W openrelayprojectsecret -p 80 $H
try "old static login, UDP 80" -u openrelayproject -w openrelayproject -p 80 openrelay.metered.ca
try "old static login, TCP 443" -t -u openrelayproject -w openrelayproject -p 443 openrelay.metered.ca
