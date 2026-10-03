#!/usr/bin/env bash
set -euo pipefail

# Runs inside the image after packages and custom files are installed.
# Configure both accounts explicitly; the build itself runs as root.
for account in umbrel root; do
    usermod --shell /bin/bash "$account"
    account_home=$(getent passwd "$account" | cut -d: -f6)
    account_group=$(id -gn "$account")
    for file in .bashrc .bash_aliases .vimrc; do
        install -o "$account" -g "$account_group" -m 0644 \
            "/etc/skel/$file" "$account_home/$file"
    done
    # Suppress login messages on transports that honor hushlogin (such as SSH).
    install -o "$account" -g "$account_group" -m 0644 /dev/null "$account_home/.hushlogin"
done

# /home is seeded once and persisted; /root returns to these defaults each boot.
# Never run this script at startup or overwrite existing persistent home files.

# Compile the portable Ghostty description into the image's global database.
# A system-wide entry also works for sudo/root without TERMINFO overrides.
customization_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
tic -x -o /usr/share/terminfo "$customization_dir/terminfo/xterm-ghostty.terminfo"
infocmp -x -A /usr/share/terminfo xterm-ghostty >/dev/null

# Validate the installed server configuration without starting services in Docker.
# Fail the build if the distribution no longer loads our SSH policy drop-in.
grep -Eq '^Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config
install -d -m 0755 /run/sshd
/usr/sbin/sshd -t

# Enable additional image-owned systemd services here with systemctl enable.
