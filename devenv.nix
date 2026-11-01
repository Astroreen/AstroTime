{ pkgs, ... }:

# AstroTime dev environment: Node.js + pnpm for the TypeScript monorepo, and
# the Android SDK and JDK that build apps/mobile's APK.
# The product itself never requires nix; this shell is a convenience only.
let
  # What Capacitor 8's Gradle build needs, and nothing more: no emulator,
  # system images, NDK, CMake or the old SDK tools (docs/plans/android.md#D69).
  # A device or an emulator outside the shell runs the debug APK.
  # Its sdkmanager runs on the shell's headless JDK, not the full JDK 17
  # (with GTK) that androidenv wraps it with: half the download.
  androidenv = (pkgs.extend (_: _: { jdk17 = pkgs.jdk21_headless; })).androidenv;
  android = androidenv.composeAndroidPackages {
    platformVersions = [ "36" ];
    buildToolsVersions = [ "35.0.0" ];
    includeEmulator = false;
    includeSystemImages = false;
    includeNDK = false;
    includeCmake = false;
    toolsVersion = null;
  };
  androidHome = "${android.androidsdk}/libexec/android-sdk";
in
{
  languages.javascript = {
    enable = true;
    package = pkgs.nodejs_24;
    pnpm.enable = true;
  };

  # Capacitor 8's Gradle build runs on JDK 21.
  languages.java = {
    enable = true;
    jdk.package = pkgs.jdk21_headless;
  };

  # A real CalDAV server for the integration tests (AGENTS.md), and openssl
  # for the dev server's self-signed certificate (scripts/t3/dev.sh).
  packages = [
    pkgs.radicale
    pkgs.openssl
    android.androidsdk
  ];

  env.ANDROID_HOME = androidHome;
  # Gradle's aapt2 comes from Maven, built for other Linuxes; nixpkgs' runs here.
  env.GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidHome}/build-tools/35.0.0/aapt2";

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
