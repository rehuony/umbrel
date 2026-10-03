alias ll='ls -lAF'
alias la='ls -AF'
alias l='ls -CF'
alias cls='clear'
# Explicitly forget this account's Bash history when using quit instead of exit.
alias quit='rm -f "$HOME/.bash_history" && history -c && exit'
