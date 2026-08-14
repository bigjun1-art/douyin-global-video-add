#!/bin/bash
set -euo pipefail

ADVID=""
ADID=""
PT=""
CODE=""
ACTIVATE="false"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --advid) ADVID="${2:-}"; shift 2 ;;
        --adid) ADID="${2:-}"; shift 2 ;;
        --pt) PT="${2:-}"; shift 2 ;;
        --code) CODE="${2:-}"; shift 2 ;;
        --activate) ACTIVATE="true"; shift ;;
        *) echo "ERROR: unknown argument: $1" >&2; exit 2 ;;
    esac
done

if [[ ! "$ADVID" =~ ^[0-9]+$ ]] || [[ ! "$ADID" =~ ^[0-9]+$ ]]; then
    echo "ERROR: --advid and --adid are required numeric identifiers" >&2
    exit 2
fi
if [[ "$PT" != "videopoi" && "$PT" != "liveproduct" ]]; then
    echo "ERROR: --pt must be videopoi or liveproduct" >&2
    exit 2
fi
if [[ -z "$CODE" ]]; then
    echo "ERROR: --code is required" >&2
    exit 2
fi

CODE_B64=$(printf '%s' "$CODE" | base64 | tr -d '\n')
EVAL_CODE="(()=>{try{const r=eval(new TextDecoder().decode(Uint8Array.from(atob('$CODE_B64'),c=>c.charCodeAt(0))));return JSON.stringify({ok:true,result:r===undefined?null:r})}catch(e){return JSON.stringify({ok:false,error:String(e&&e.stack||e)})}})()"

RESULT=$(osascript <<EOF
tell application "Google Chrome"
    set targetCount to 0
    set targetTab to missing value
    set targetWindow to missing value
    set targetTabIndex to 0
    repeat with w from 1 to count of windows
        repeat with t from 1 to count of tabs of window w
            set tabURL to URL of tab t of window w
            if tabURL contains "localads.chengzijianzhan.cn/lamp/pc/create/roi2" and tabURL contains "advid=$ADVID" and tabURL contains "adId=$ADID" and tabURL contains "pt=$PT" and tabURL contains "type=edit" then
                set targetCount to targetCount + 1
                set targetTab to tab t of window w
                set targetWindow to window w
                set targetTabIndex to t
            end if
        end repeat
    end repeat
    if targetCount is 0 then return "ERROR: exact edit tab not found"
    if targetCount is not 1 then return "ERROR: exact edit tab is not unique; count=" & targetCount
    if "$ACTIVATE" is "true" then
        set index of targetWindow to 1
        set active tab index of targetWindow to targetTabIndex
        activate
    end if
    try
        return execute targetTab javascript "$EVAL_CODE"
    on error errMsg
        return "ERROR: evaluation failed - " & errMsg
    end try
end tell
EOF
)

echo "$RESULT"
if [[ "$RESULT" == ERROR:* ]] || [[ "$RESULT" == *'"ok":false'* ]]; then exit 1; fi
