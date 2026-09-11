#!/bin/sh
# Fix the data directory, then drop root.
#
# The data directory is a mounted volume, so what the image did to it at build
# time is hidden the moment the volume is attached, and its contents carry
# whatever ownership the host or an earlier run gave them. An install that ran
# as root before this image dropped privileges leaves a root-owned config.db
# that the application user cannot write, and SQLite reports that as
# "attempt to write a readonly database".
#
# Anything already running as a non-root user is left alone, so `--user` on the
# command line still does what it says.
set -e

if [ "$(id -u)" = "0" ]; then
    data_dir="$(dirname "${DB_PATH:-/app/server/data/config.db}")"

    for path in "$data_dir" "${BUCKET_DIR:-/app/server/data/buckets}"; do
        [ -n "$path" ] || continue
        mkdir -p "$path" 2>/dev/null || true
        # a read-only mount cannot be fixed from in here; let the application
        # report that itself rather than failing with a chown error
        chown -R datapilot:datapilot "$path" 2>/dev/null || true
    done

    exec setpriv --reuid=datapilot --regid=datapilot --init-groups "$@"
fi

exec "$@"
