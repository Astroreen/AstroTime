{ pkgs, ... }:

# AstroTime dev environment: Node.js + pnpm for the TypeScript monorepo.
# The product itself never requires nix; this shell is a convenience only.
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  # Playwright cannot run its downloaded browsers on NixOS; use the nixpkgs
  # build instead. `playwright` in pnpm-workspace.yaml is pinned to the same
  # version as `pkgs.playwright-driver` (as in Jhin).
  env.PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
  env.PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "true";

  # A host LD_LIBRARY_PATH (audio libraries for games, say) loads libraries
  # built against another glibc into Chromium and Node addons; the dev shell
  # links everything through the nix store and needs none.
  enterShell = ''
    unset LD_LIBRARY_PATH
  '';
}
