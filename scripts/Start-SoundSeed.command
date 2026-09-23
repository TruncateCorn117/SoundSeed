#!/bin/sh
set -eu
SOUNDSEED_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if ! command -v python3 >/dev/null 2>&1; then
  printf '%s\n' 'SoundSeed needs Python 3.8 or newer.' 'Install Python 3 from https://www.python.org/downloads/ and try again.'
  printf '%s' 'Press Enter to close this window: '
  read -r SOUNDSEED_ANSWER
  exit 1
fi
python3 "$SOUNDSEED_DIR/start.py" "$@"
