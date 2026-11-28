#!/usr/bin/env bash
# 📱 Builds the সবমিলবে SMS app (android-sms/) with the plain Android SDK tools — no Gradle, no outside libraries.
#   ANDROID_HOME=/path/to/sdk  KEYSTORE=/path/to/shobmilbe-sms.jks  KEYPASS=…  ./android-sms/build.sh
# Needs: JDK 17+, Android SDK "platforms;android-35" and "build-tools;35.0.0".
# Output: android-sms/out/shobmilbe-sms.apk (signed). Raise VERSION_CODE / VERSION_NAME for every new release —
# and sign with the SAME key (the owner keeps it), or the phone refuses the update.
set -euo pipefail
VERSION_CODE=1
VERSION_NAME=1.0

HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/android-sdk}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
OUT="$HERE/out"; TMP="$OUT/tmp"
rm -rf "$TMP"; mkdir -p "$TMP/classes" "$TMP/gen"

# aapt2 wants the package name in the manifest
sed 's#<manifest xmlns:android="http://schemas.android.com/apk/res/android">#<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.shobmilbe.sms">#' \
  "$HERE/app/src/main/AndroidManifest.xml" > "$TMP/AndroidManifest.xml"

"$BT/aapt2" compile --dir "$HERE/app/src/main/res" -o "$TMP/res.zip"
"$BT/aapt2" link -I "$JAR" --manifest "$TMP/AndroidManifest.xml" -o "$TMP/base.apk" --java "$TMP/gen" \
  --min-sdk-version 24 --target-sdk-version 35 --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$TMP/res.zip"

javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 -bootclasspath "$JAR:$BT/core-lambda-stubs.jar" -d "$TMP/classes" \
  $(find "$HERE/app/src/main/java" "$TMP/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$TMP" $(find "$TMP/classes" -name '*.class')

cp "$TMP/base.apk" "$TMP/unsigned.apk"
(cd "$TMP" && zip -q -j unsigned.apk classes.dex)
"$BT/zipalign" -f -p 4 "$TMP/unsigned.apk" "$TMP/aligned.apk"
"$BT/apksigner" sign --ks "${KEYSTORE:?set KEYSTORE}" --ks-pass "pass:${KEYPASS:?set KEYPASS}" --out "$OUT/shobmilbe-sms.apk" "$TMP/aligned.apk"
"$BT/apksigner" verify "$OUT/shobmilbe-sms.apk"
rm -rf "$TMP"
echo "OK: $OUT/shobmilbe-sms.apk"
