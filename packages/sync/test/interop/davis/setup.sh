#!/bin/sh
# Davis configured without its admin pages (docs/plans/providers.md#D248):
# its SQLite database from its own migrations, and one user, `astro` with the
# password `secret` (bcrypt, as its admin pages hash it), authenticated by
# AUTH_METHOD; then the image's own command (Caddy and PHP-FPM).
set -eu
cd /var/www/davis
db=/var/www/davis/var/data.db
# Written once the user is in: a start that stopped halfway makes it all again.
made=/var/www/davis/var/.astrotime-made
if [ ! -f "$made" ]; then
  rm -f "$db"
  php bin/console doctrine:migrations:migrate --no-interaction --quiet
  php -r '
    $db = new PDO("sqlite:" . $argv[1]);
    $db->prepare("INSERT INTO users (username, digesta1) VALUES (?, ?)")
      ->execute(["astro", password_hash("secret", PASSWORD_DEFAULT)]);
    $db->prepare("INSERT INTO principals (uri, email, displayname, is_main, is_admin) VALUES (?, ?, ?, 1, 0)")
      ->execute(["principals/astro", "astro@example.com", "Astro"]);
  ' "$db"
  chown -R www-data:www-data var
  touch "$made"
fi
exec docker-php-entrypoint /usr/bin/supervisord -c /etc/supervisord.conf
