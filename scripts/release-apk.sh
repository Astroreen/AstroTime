#!/usr/bin/env bash
# The release's APK (docs/plans/android.md#D69): Gradle's release build,
# with no signing config, named astrotime-<version>-unsigned.apk, checked to
# be unsigned and to carry the root package.json's version. Run from the
# repository's root after `./gradlew assembleRelease`; prints the APK's path.
set -euo pipefail

version="$(node -p 'require("./package.json").version')"
outputs=apps/mobile/android/app/build/outputs/apk/release
apk="${outputs}/astrotime-${version}-unsigned.apk"
cp "${outputs}/app-release-unsigned.apk" "$apk"

tools="${ANDROID_HOME}/build-tools/35.0.0"
if "${tools}/apksigner" verify "$apk" > "${outputs}/apksigner.log" 2>&1; then
  echo "${apk} is signed; a release APK must not be" >&2
  exit 1
fi
cat "${outputs}/apksigner.log" >&2
grep -q "DOES NOT VERIFY" "${outputs}/apksigner.log"

"${tools}/aapt2" dump badging "$apk" > "${outputs}/badging.txt"
grep "^package:" "${outputs}/badging.txt" >&2
grep -qF "versionName='${version}'" "${outputs}/badging.txt"

echo "$apk"
