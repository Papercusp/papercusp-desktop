#!/usr/bin/env bash
# fed-net.sh — Phase-2 federation networking for the Linux test VMs.
# Sourced by bin/vm-federation.sh (after lib/common.sh).
# Plan: linux-test-vm-and-federation-2026-06-04 P-008 (D-002, amended: no
# dnsmasq/NAT — see the plan's decision log).
#
# Two modes, both DUAL-NIC (every fed VM keeps its Phase-1 slirp NIC for
# internet + SSH-hostfwd + SPICE; the federation network is a SECOND NIC):
#
#   bridge (primary, needs sudo) — host bridge `pcusp-fedbr0` 10.77.0.0/24
#     (the plan's `papercusp-fedbr0` exceeds the kernel IFNAMSIZ 15-char cap),
#     host = 10.77.0.1. Each VM gets a host tap on the bridge and a STATIC
#     guest IP (10.77.0.2, .3, …) configured over SSH — no dnsmasq, no DHCP
#     race, no iptables (internet rides the slirp NIC). The host runs the
#     hyperdht/testnet bootstrap advertised on 10.77.0.1, so VMs reach the
#     DHT, each other, and the host over a real network hop.
#
#   socket (rootless fallback, exactly two VMs) — a qemu `-netdev socket`
#     point-to-point L2 link (VM-A listens on 127.0.0.1, VM-B connects),
#     static 10.99.0.1/2. The host is NOT on this L2, so the DHT bootstrap
#     must run INSIDE VM-A (vm-federation.sh handles that).
#
# Deterministic MACs (52:54:00:fd:77:0<idx>) let the guest side find the fed
# NIC by MAC — netplan only manages the slirp NIC it saw at provision time.

FEDBR="pcusp-fedbr0"
FEDBR_HOST_IP="10.77.0.1"
FEDBR_CIDR=24
SOCKET_LINK_PORT="${PAPERCUSP_FED_SOCKET_PORT:-18999}"

fednet_mac()      { printf '52:54:00:fd:77:0%d' "$1"; }          # <idx 1|2>
fednet_tap()      { printf 'fedtap%d' "$1"; }                     # <idx>
fednet_bridge_ip(){ printf '10.77.0.%d' "$(( $1 + 1 ))"; }        # idx 1 → .2
fednet_socket_ip(){ printf '10.99.0.%d' "$1"; }                   # idx 1 → .1

# Root is needed only for bridge mode (bridge + tap creation).
fednet_have_root() { sudo -n true 2>/dev/null; }

# ── bridge mode (host side) ─────────────────────────────────────────────────

fednet_bridge_up() {   # idempotent
  if ! ip link show "$FEDBR" >/dev/null 2>&1; then
    log "creating bridge $FEDBR ($FEDBR_HOST_IP/$FEDBR_CIDR)"
    sudo ip link add "$FEDBR" type bridge
  fi
  sudo ip addr replace "$FEDBR_HOST_IP/$FEDBR_CIDR" dev "$FEDBR"
  sudo ip link set "$FEDBR" up
}

fednet_tap_up() {      # fednet_tap_up <idx> — tap owned by $USER, on the bridge
  local tap; tap="$(fednet_tap "$1")"
  if ! ip link show "$tap" >/dev/null 2>&1; then
    log "creating tap $tap (user $USER) on $FEDBR"
    sudo ip tuntap add dev "$tap" mode tap user "$USER"
  fi
  sudo ip link set "$tap" master "$FEDBR"
  sudo ip link set "$tap" up
}

fednet_bridge_down() { # remove taps + bridge (best-effort)
  local i tap
  for i in 1 2; do
    tap="$(fednet_tap "$i")"
    ip link show "$tap" >/dev/null 2>&1 && sudo ip link del "$tap" 2>/dev/null || true
  done
  ip link show "$FEDBR" >/dev/null 2>&1 && sudo ip link del "$FEDBR" 2>/dev/null || true
}

# ── FED_NIC args for boot-vm.sh ─────────────────────────────────────────────
# boot-vm.sh word-splits $FED_NIC into extra qemu args (no spaces per arg).

fednet_nic_args() {    # fednet_nic_args <mode> <idx> → echo FED_NIC value
  local mode="$1" idx="$2" mac; mac="$(fednet_mac "$idx")"
  case "$mode" in
    bridge)
      echo "-netdev tap,id=fed0,ifname=$(fednet_tap "$idx"),script=no,downscript=no -device virtio-net-pci,netdev=fed0,mac=$mac" ;;
    socket)
      if [ "$idx" = 1 ]; then
        echo "-netdev socket,id=fed0,listen=127.0.0.1:$SOCKET_LINK_PORT -device virtio-net-pci,netdev=fed0,mac=$mac"
      else
        echo "-netdev socket,id=fed0,connect=127.0.0.1:$SOCKET_LINK_PORT -device virtio-net-pci,netdev=fed0,mac=$mac"
      fi ;;
    *) die "fednet_nic_args: unknown mode $mode" ;;
  esac
}

# ── guest-side static IP (over SSH; netplan ignores the 2nd NIC) ────────────

fednet_guest_configure() {  # <vmname> <idx> <mode>
  local name="$1" idx="$2" mode="$3" mac ip
  mac="$(fednet_mac "$idx")"
  case "$mode" in
    bridge) ip="$(fednet_bridge_ip "$idx")/$FEDBR_CIDR" ;;
    socket) ip="$(fednet_socket_ip "$idx")/24" ;;
  esac
  log "configuring fed NIC in $name (mac $mac → $ip)"
  vm_run "$name" <<EOF
set -e
iface=""
for d in /sys/class/net/*; do
  [ "\$(cat "\$d/address" 2>/dev/null)" = "$mac" ] && iface="\$(basename "\$d")" && break
done
[ -n "\$iface" ] || { echo "fed NIC (mac $mac) not found in guest"; exit 1; }
sudo ip addr replace "$ip" dev "\$iface"
sudo ip link set "\$iface" up
echo "fed NIC \$iface up at $ip"
EOF
}

# fednet_guest_ping <vmname> <target_ip> — cheap reachability probe.
#
# ⚠ ICMP-ONLY. This says NOTHING about whether the guest can deliver UDP to the
# host, and hyperdht/udx speak ONLY UDP. Pair it with fednet_guest_udp_ok below;
# see that function's header for the failure this asymmetry hid (WI-760).
fednet_guest_ping() {
  local name="$1" target="$2"
  vm_run "$name" <<EOF
ping -c1 -W2 "$target" >/dev/null 2>&1 && echo reachable || echo UNREACHABLE
EOF
}

# fednet_guest_udp_ok <vmname> <host_ip> [port] — assert the guest can actually
# DELIVER a UDP datagram to the host on the rig bridge. Echoes "ok" or "BLOCKED".
#
# WHY THIS EXISTS (WI-760, 2026-07-26). The host runs ufw with a default-deny
# INPUT policy and carries explicit per-subnet ALLOW rules for the other rig
# bridges (172.31.44.0/24, 10.99.0.0/24, 10.97.0.0/24) — but 10.77.0.0/24, the
# pcusp-fedbr0 fed-a/fed-b bridge, was never added. So every UDP datagram from a
# fed VM to the host-run testnet DHT was silently dropped, no hyperdht announce
# ever landed, and the rig could NEVER peer.
#
# It stayed hidden for weeks because ufw's before-rules permit ICMP echo: the
# driver's own preflight asked "can the guest ping the host?", got `reachable`,
# and printed green while the ONLY protocol federation depends on was 100%
# blocked. A reachability check that passes on a protocol the system under test
# does not use is not a reachability check — assert the real transport.
#
# Deliberately dependency-free on the host side (python3 only, no nc: netcat
# variants disagree on whether `-p` sets the LISTEN or the SOURCE port, and the
# wrong variant yields a false BLOCKED).
fednet_guest_udp_ok() {
  local name="$1" host_ip="$2" port="${3:-45999}"
  local rx tag="fednet-udp-$$-$RANDOM"
  rx="$(mktemp)"
  python3 -c "
import socket, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('$host_ip', $port))
s.settimeout(12)
try:
    data, _ = s.recvfrom(4096)
    sys.stdout.write(data.decode('utf-8', 'replace'))
except socket.timeout:
    sys.stdout.write('TIMEOUT')
" >"$rx" 2>/dev/null &
  local listener=$!
  sleep 1
  vm_run "$name" <<EOF >/dev/null 2>&1
python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for _ in range(3):
    s.sendto(b'$tag', ('$host_ip', $port))
" 2>/dev/null || for _ in 1 2 3; do echo -n '$tag' >/dev/udp/$host_ip/$port 2>/dev/null; done
EOF
  wait "$listener" 2>/dev/null || true
  if grep -q "$tag" "$rx" 2>/dev/null; then rm -f "$rx"; echo ok; else rm -f "$rx"; echo BLOCKED; fi
}

# fednet_guest_udp_pair <src_vm> <dst_vm> <dst_ip> [port] — assert one guest can
# DELIVER a UDP datagram to the OTHER guest across the rig bridge. Echoes "ok" or
# "BLOCKED".
#
# WHY THIS IS SEPARATE from fednet_guest_udp_ok (WI-760): guest→host and
# guest→guest are different firewall paths and failed INDEPENDENTLY here.
#   - guest→host  traverses the INPUT chain  (ufw default-deny incoming)
#   - guest→guest traverses the FORWARD chain, because br_netfilter
#     (bridge-nf-call-iptables=1) pushes bridged frames through iptables, and
#     ufw's routed policy is deny.
# Fixing only the first gets you a rig that reaches the DHT, announces fine, and
# reports `peer_connected` — while the UDX data path carries ZERO bytes, because
# signalling is host-relayed but the stream is direct VM↔VM. That is precisely
# the state this rig was in, and the app's own log named it:
#   "data path NEVER came up ... `peer_connected` for this peer was a false
#    success report, not a working connection."
# So assert BOTH paths, or a green preflight still yields an unpeerable rig.
fednet_guest_udp_pair() {
  local src="$1" dst="$2" dst_ip="$3" port="${4:-45998}"
  local tag="fednet-pair-$$-$RANDOM"
  vm_run "$dst" <<EOF >/dev/null 2>&1
rm -f /tmp/fednet-udp-pair.txt
setsid python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(('0.0.0.0', $port)); s.settimeout(20)
try:
    d, _ = s.recvfrom(4096)
    open('/tmp/fednet-udp-pair.txt','w').write(d.decode('utf-8','replace'))
except Exception:
    open('/tmp/fednet-udp-pair.txt','w').write('TIMEOUT')
" </dev/null >/dev/null 2>&1 &
EOF
  sleep 3
  vm_run "$src" <<EOF >/dev/null 2>&1
python3 -c "
import socket, time
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
for _ in range(5):
    s.sendto(b'$tag', ('$dst_ip', $port)); time.sleep(0.4)
"
EOF
  local out
  out="$(vm_run "$dst" <<EOF 2>/dev/null
for _ in \$(seq 1 8); do [ -s /tmp/fednet-udp-pair.txt ] && break; sleep 3; done
cat /tmp/fednet-udp-pair.txt 2>/dev/null
EOF
)"
  case "$out" in *"$tag"*) echo ok ;; *) echo BLOCKED ;; esac
}
