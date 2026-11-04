#!/bin/sh
# Baïkal configured without its install wizard (docs/plans/providers.md#D248):
# the configuration its wizard would write, its SQLite database from its own
# schema, and one user, `astro` with the password `secret`, authenticated by
# BAIKAL_AUTH (`Digest`, Baïkal's default, or `Basic`). Run by the image's
# entrypoint (/docker-entrypoint.d) before PHP starts.
set -eu
root=/var/www/baikal
# nginx listens on the port the host maps, as a real deployment's does: its
# `.well-known` redirect is absolute and names the port nginx listens on.
sed -i "s/listen 80;/listen ${BAIKAL_PORT};/; s/listen \[::\]:80;/listen [::]:${BAIKAL_PORT};/" /etc/nginx/conf.d/default.conf
[ -f "$root/config/baikal.yaml" ] && exit 0
realm=BaikalDAV
cat > "$root/config/baikal.yaml" <<YAML
system:
  configured_version: '0.10.1'
  timezone: 'UTC'
  card_enabled: false
  cal_enabled: true
  dav_auth_type: '${BAIKAL_AUTH}'
  admin_passwordhash: '$(printf '%s' "admin:$realm:admin-password" | md5sum | cut -d' ' -f1)'
  failed_access_message: 'user %u authentication failure for Baikal'
  auth_realm: '$realm'
  base_uri: ''
  invite_from: ''
database:
  sqlite_file: '$root/Specific/db/db.sqlite'
  backend: 'sqlite'
  mysql_host: ''
  mysql_dbname: ''
  mysql_username: ''
  mysql_password: ''
  encryption_key: 'astrotime-interop'
  pgsql_host: ''
  pgsql_dbname: ''
  pgsql_username: ''
  pgsql_password: ''
YAML
mkdir -p "$root/Specific/db"
sqlite3 "$root/Specific/db/db.sqlite" < "$root/Core/Resources/Db/SQLite/db.sql"
digest=$(printf '%s' "astro:$realm:secret" | md5sum | cut -d' ' -f1)
sqlite3 "$root/Specific/db/db.sqlite" <<SQL
INSERT INTO users (username, digesta1) VALUES ('astro', '$digest');
INSERT INTO principals (uri, email, displayname) VALUES ('principals/astro', 'astro@example.com', 'Astro');
SQL
chown -R nginx:nginx "$root/config" "$root/Specific"
