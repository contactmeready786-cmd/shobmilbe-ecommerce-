#!/usr/bin/env bash
# 📱 Signs the two Android apps with the owner's key and publishes them — run by the "android" workflow after the build.
#
#   customer app → GitHub release "app-v<version>" with the file "shobmilbe.apk", marked latest. The shop's download
#                  button (/app/download → next.config.ts) always opens …/releases/latest/download/shobmilbe.apk, so a
#                  new version is downloadable the moment it is published, and the older customer releases are deleted.
#   admin app    → a DRAFT release "admin-v<version>" (drafts are visible only to the repository's owner), "shobmilbe-admin.apk";
#                  older admin drafts are deleted.
#
# Needs two repository secrets (Settings → Secrets and variables → Actions): ANDROID_KEYSTORE_B64 (the .jks file in
# base64) and ANDROID_KEY_PASS (its password — store and key share it). Without them nothing is published (a warning).
# A version that is already published is left alone: an update needs a new appVersionName/appVersionCode.
set -euo pipefail

O="$RUNNER_TEMP/out"
REPO="$GITHUB_REPOSITORY"
if [ "$(cat "$O/status" 2>/dev/null)" != 0 ]; then echo "build failed — nothing to publish"; exit 0; fi

VER=$(sed -n 's/^appVersionName=//p' android/gradle.properties | tr -d '[:space:]')
TAG="app-v$VER"
ATAG="admin-v$VER"
echo "app version $VER"

release_id() { # $1 = tag name (drafts included)
  gh api "repos/$REPO/releases?per_page=100" --jq ".[] | select(.tag_name==\"$1\") | .id" | head -1
}

if [ -n "$(release_id "$TAG")" ]; then
  echo "$TAG is already published — nothing to do (a new version needs a higher appVersionName / appVersionCode)"
  exit 0
fi
if [ -z "${KS_B64:-}" ] || [ -z "${KS_PASS:-}" ]; then
  echo "::warning::App $VER is not published: the signing key is not in the repository secrets (ANDROID_KEYSTORE_B64, ANDROID_KEY_PASS)."
  exit 0
fi

BT=$(ls -d "$ANDROID_HOME"/build-tools/* | sort -V | tail -1)
W="$RUNNER_TEMP/sign"
mkdir -p "$W"
umask 077
trap 'rm -rf "$W"' EXIT
printf '%s' "$KS_B64" | base64 -d > "$W/ks.jks"
printf '%s\n' "$KS_PASS" > "$W/p1"
printf '%s\n' "$KS_PASS" > "$W/p2"

# the key must be the one the shop trusts (public/.well-known/assetlinks.json) — never publish with another key
WANT=$(jq -r '.[0].target.sha256_cert_fingerprints[0]' public/.well-known/assetlinks.json | tr -d ':' | tr 'A-Z' 'a-z')

sign() { # $1 = unsigned apk, $2 = signed output
  "$BT/zipalign" -f 4 "$1" "$W/aligned.apk"
  "$BT/apksigner" sign --ks "$W/ks.jks" --ks-key-alias shobmilbe --ks-pass "file:$W/p1" --key-pass "file:$W/p2" --out "$2" "$W/aligned.apk"
  rm -f "$2.idsig"
  local got
  got=$("$BT/apksigner" verify --print-certs "$2" | grep -i 'SHA-256 digest' | head -1 | awk '{print $NF}')
  if [ "$got" != "$WANT" ]; then echo "::error::$2 is signed with a different key ($got), not the shop's ($WANT)"; exit 1; fi
}

CUST=$(find android/app/build/outputs/apk -name '*customer*-release-unsigned.apk' | head -1)
ADM=$(find android/app/build/outputs/apk -name '*admin*-release-unsigned.apk' | head -1)
sign "$CUST" "$W/shobmilbe.apk"
sign "$ADM" "$W/shobmilbe-admin.apk"

upload() { # $1 = release id, $2 = file
  gh api --method POST -H "Content-Type: application/vnd.android.package-archive" \
    "https://uploads.github.com/repos/$REPO/releases/$1/assets?name=$(basename "$2")" --input "$2" --jq '.name + " " + (.size|tostring)'
}

# 1) the admin app: a private draft
AID=$(release_id "$ATAG")
[ -n "$AID" ] && gh api -X DELETE "repos/$REPO/releases/$AID"
AID=$(gh api "repos/$REPO/releases" -f tag_name="$ATAG" -f target_commitish="$GITHUB_SHA" -f name="অ্যাডমিন অ্যাপ $VER (শুধু মালিক)" \
  -f body="সবমিলবে অ্যাডমিন Android অ্যাপ $VER। খসড়া (draft) — শুধু রিপোজিটরির মালিক দেখতে পান। ফোনে নামিয়ে আগেরটার উপর ইনস্টল করুন।" -F draft=true --jq .id)
upload "$AID" "$W/shobmilbe-admin.apk"

# 2) the customer app: the new latest release (published last, so it is complete before anyone gets it)
RID=$(gh api "repos/$REPO/releases" -f tag_name="$TAG" -f target_commitish="$GITHUB_SHA" -f name="সবমিলবে অ্যাপ $VER" \
  -f body="সবমিলবে কাস্টমার Android অ্যাপ $VER। দোকানের shobmilbe.com/app পেজ সবসময় সর্বশেষ সংস্করণটাই দেয়।" -F draft=true --jq .id)
upload "$RID" "$W/shobmilbe.apk"
gh api -X PATCH "repos/$REPO/releases/$RID" -F draft=false -f make_latest=true --jq '.html_url'

# 3) the older versions go (the download button already gives the new one)
gh api "repos/$REPO/releases?per_page=100" --jq '.[] | [.id, .tag_name, .draft] | @tsv' | while IFS=$'\t' read -r id tag draft; do
  case "$tag" in
    app-v*) if [ "$tag" != "$TAG" ]; then gh api -X DELETE "repos/$REPO/releases/$id"; gh api -X DELETE "repos/$REPO/git/refs/tags/$tag" 2>/dev/null || true; echo "removed $tag"; fi ;;
    admin-v*) if [ "$tag" != "$ATAG" ]; then gh api -X DELETE "repos/$REPO/releases/$id"; echo "removed $tag"; fi ;;
  esac
done
echo "published app $VER"
