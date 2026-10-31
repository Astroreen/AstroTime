{ pkgs, ... }:

# AstroTime dev environment: Node.js + pnpm for the TypeScript monorepo.
# The product itself never requires nix; this shell is a convenience only.
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };
}
