#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/gog-drive-download-safe.sh <file_id> [--out <path>] [--account <email>] [--max-mb <n>] [--retries <n>] [--timeout-sec <n>] [--allow-large]

Behavior:
  - Fetch Drive metadata first (name, size, mimeType, webViewLink).
  - By default, skip files larger than --max-mb (default: 100 MB).
  - Retry small/allowed downloads.
  - Non-Google-Docs files use curl with OAuth token refresh (custom timeout works).
  - Google Docs files still use gog export/download behavior.

Examples:
  scripts/gog-drive-download-safe.sh 1AbCdEf...
  scripts/gog-drive-download-safe.sh 1AbCdEf... --out ./IMG_1234.MOV --max-mb 80
  scripts/gog-drive-download-safe.sh 1AbCdEf... --allow-large --retries 2 --timeout-sec 900
EOF
}

if [[ "${1:-}" == "" ]] || [[ "${1:-}" == "-h" ]] || [[ "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v gog >/dev/null 2>&1; then
  echo "error: gog not found in PATH" >&2
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "error: python3 not found in PATH" >&2
  exit 1
fi

FILE_ID="$1"
shift

if [[ "$FILE_ID" == *"*"* ]] || [[ "$FILE_ID" == *"?"* ]] || [[ "$FILE_ID" == *"["* ]]; then
  echo "error: file_id looks like a wildcard pattern ('$FILE_ID')" >&2
  echo "hint : pass a concrete Google Drive file ID, not a glob like '*.jpg'" >&2
  exit 1
fi

if [[ ! "$FILE_ID" =~ ^[A-Za-z0-9_-]{10,}$ ]]; then
  echo "error: invalid Google Drive file ID format: $FILE_ID" >&2
  echo "hint : expected an ID such as 1AbCdEfGhIjKlMnOpQrStUvWxYz" >&2
  exit 1
fi

OUT_PATH=""
ACCOUNT="${GOG_ACCOUNT:-}"
MAX_MB=100
RETRIES=3
TIMEOUT_SEC=600
ALLOW_LARGE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)
      OUT_PATH="${2:-}"
      shift 2
      ;;
    --account)
      ACCOUNT="${2:-}"
      shift 2
      ;;
    --max-mb)
      MAX_MB="${2:-}"
      shift 2
      ;;
    --retries)
      RETRIES="${2:-}"
      shift 2
      ;;
    --timeout-sec)
      TIMEOUT_SEC="${2:-}"
      shift 2
      ;;
    --allow-large)
      ALLOW_LARGE=1
      shift
      ;;
    *)
      echo "error: unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$ACCOUNT" ]]; then
  AUTH_JSON="$(gog auth list --json)"
  ACCOUNT="$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; data=json.load(sys.stdin); accounts=[a.get("email","") for a in data.get("accounts",[]) if a.get("email")]; print(accounts[0] if len(accounts)==1 else "")')"
fi

if [[ -z "$ACCOUNT" ]]; then
  echo "error: account is required. Pass --account or set GOG_ACCOUNT." >&2
  exit 1
fi

META_ERR_FILE="$(mktemp)"
trap 'rm -f "$META_ERR_FILE"' EXIT
if ! META_JSON="$(gog drive get "$FILE_ID" --account "$ACCOUNT" --json 2>"$META_ERR_FILE")"; then
  echo "error: failed to fetch Drive metadata for file ID: $FILE_ID" >&2
  if [[ -s "$META_ERR_FILE" ]]; then
    sed 's/^/detail: /' "$META_ERR_FILE" >&2
  fi
  echo "hint : verify the file exists and your account ($ACCOUNT) has access." >&2
  exit 1
fi
META_LINE="$(printf '%s' "$META_JSON" | python3 -c 'import json,sys; f=json.load(sys.stdin).get("file",{}); name=f.get("name","").replace("\t"," "); size=str(int(f.get("size") or 0)); mime=f.get("mimeType","").replace("\t"," "); link=f.get("webViewLink","").replace("\t"," "); print("\t".join([name,size,mime,link]))')"
IFS=$'\t' read -r FILE_NAME FILE_SIZE_BYTES FILE_MIME FILE_LINK <<< "$META_LINE"

if [[ -z "$FILE_NAME" ]]; then
  echo "error: failed to resolve file name for id: $FILE_ID" >&2
  exit 1
fi

if [[ -z "$OUT_PATH" ]]; then
  OUT_PATH="./$FILE_NAME"
fi

FILE_SIZE_MB="$(python3 - <<PY
size=$FILE_SIZE_BYTES
print(f"{size/1024/1024:.1f}")
PY
)"

REQUIRED_MBPS="$(python3 - <<PY
size=$FILE_SIZE_BYTES
print(f"{size/1024/1024/30:.2f}")
PY
)"

echo "File ID   : $FILE_ID"
echo "Name      : $FILE_NAME"
echo "Mime      : $FILE_MIME"
echo "Size      : $FILE_SIZE_MB MB ($FILE_SIZE_BYTES bytes)"
echo "Account   : $ACCOUNT"
echo "Output    : $OUT_PATH"
echo "Timeout   : ${TIMEOUT_SEC}s"
echo "Web link  : $FILE_LINK"

if [[ "$ALLOW_LARGE" -ne 1 ]] && python3 - <<PY
size=$FILE_SIZE_BYTES
max_mb=float("$MAX_MB")
raise SystemExit(0 if size > max_mb*1024*1024 else 1)
PY
then
  echo
  echo "skip: file is larger than --max-mb=${MAX_MB} MB"
  echo "reason: default safety threshold to avoid very long downloads by accident"
  echo "hint  : if you want to continue, pass --allow-large (current timeout ${TIMEOUT_SEC}s)"
  echo "hint  : for 30s completion, required throughput is about ${REQUIRED_MBPS} MB/s"
  echo "action: choose a smaller asset or run again with --allow-large"
  exit 3
fi

download_with_gog() {
  gog drive download "$FILE_ID" --account "$ACCOUNT" --out "$OUT_PATH"
}

download_with_curl_oauth() {
  local token_export cred_json refresh_token client_id client_secret access_token
  local token_response tmp_stderr

  token_export="$(mktemp)"
  tmp_stderr="$(mktemp)"
  trap 'rm -f "$token_export" "$tmp_stderr"' RETURN

  gog auth tokens export "$ACCOUNT" --out "$token_export" --overwrite >/dev/null 2>&1

  refresh_token="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("refresh_token",""))' "$token_export")"
  if [[ -z "$refresh_token" ]]; then
    echo "error: missing refresh token for account $ACCOUNT" >&2
    return 1
  fi

  cred_json="$(gog auth credentials list --json | python3 -c 'import json,sys; data=json.load(sys.stdin); clients=data.get("clients",[]); d=[c for c in clients if c.get("default")]; print((d[0] if d else clients[0]).get("path","") if clients else "")')"
  if [[ -z "$cred_json" ]]; then
    echo "error: unable to locate gog OAuth credentials file" >&2
    return 1
  fi

  client_id="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("client_id",""))' "$cred_json")"
  client_secret="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("client_secret",""))' "$cred_json")"
  if [[ -z "$client_id" ]] || [[ -z "$client_secret" ]]; then
    echo "error: invalid OAuth credentials file: $cred_json" >&2
    return 1
  fi

  token_response="$(curl -sS --fail --connect-timeout 15 --max-time 30 \
    -X POST "https://oauth2.googleapis.com/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "client_id=$client_id" \
    --data-urlencode "client_secret=$client_secret" \
    --data-urlencode "refresh_token=$refresh_token" \
    --data-urlencode "grant_type=refresh_token")"

  access_token="$(printf '%s' "$token_response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("access_token",""))')"
  if [[ -z "$access_token" ]]; then
    echo "error: failed to exchange refresh token for access token" >&2
    return 1
  fi

  curl -fL \
    --connect-timeout 15 \
    --max-time "$TIMEOUT_SEC" \
    --retry 2 \
    --retry-delay 2 \
    --retry-connrefused \
    --continue-at - \
    -H "Authorization: Bearer $access_token" \
    "https://www.googleapis.com/drive/v3/files/${FILE_ID}?alt=media" \
    --output "$OUT_PATH" \
    2>"$tmp_stderr" || {
      cat "$tmp_stderr" >&2
      return 1
    }
}

attempt=1
while [[ "$attempt" -le "$RETRIES" ]]; do
  echo
  echo "download attempt ${attempt}/${RETRIES} ..."
  set +e
  if [[ "$FILE_MIME" == application/vnd.google-apps.* ]]; then
    OUTPUT="$(download_with_gog 2>&1)"
  else
    OUTPUT="$(download_with_curl_oauth 2>&1)"
  fi
  CODE=$?
  set -e
  if [[ "$CODE" -eq 0 ]]; then
    echo "$OUTPUT"
    SIZE_ON_DISK="$(ls -lh "$OUT_PATH" | awk '{print $5}')"
    echo "success: downloaded to $OUT_PATH ($SIZE_ON_DISK)"
    exit 0
  fi

  echo "$OUTPUT" >&2
  if [[ "$OUTPUT" == *"context deadline exceeded"* ]] || [[ "$OUTPUT" == *"Client.Timeout"* ]]; then
    echo "warn: timeout hit during download" >&2
  fi
  if [[ "$attempt" -lt "$RETRIES" ]]; then
    sleep_for=$(( attempt * 2 ))
    echo "retrying in ${sleep_for}s..." >&2
    sleep "$sleep_for"
  fi
  attempt=$((attempt+1))
done

echo
echo "failed: unable to download $FILE_ID after ${RETRIES} attempts" >&2
echo "web link: $FILE_LINK" >&2
exit 1
