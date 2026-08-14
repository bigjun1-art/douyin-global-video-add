---
name: douyin-global-video-add
description: Add recent videos to Douyin 巨量本地推全域 plans through the user's logged-in Chrome. Use for 直播全域 or 门店全域 material additions. Live-global is official-account only; store-global may include official, staff, and creator videos when requested.
---

# 抖音全域添加视频

Use the current logged-in Google Chrome profile. Lock the run to one exact `advid + adId + pt + type=edit` tab. Never substitute another account, plan, browser, cookie, or remembered ID.

## Source isolation

- For `live_global + liveproduct`, add official-account videos only. Never enumerate staff/creator accounts and never pass `--include-staff` or `--product-id`.
- For `store_global + videopoi`, add official-account videos and pass `--include-staff` only when the request includes staff/creator videos.
- Keep rules for separate plans isolated even when the user mentions them in one sentence.
- For store-global, preserve the current plan's complete `promotionObjectCmd` byte-for-byte. Never rebuild `POIs` from `poiIDS`, never add/remove/reorder a store, and refuse mutation unless the current complete promotion object is returned.

## Run

Live-global:

```bash
cd <skill-directory>
node scripts/run_backend_material_add.mjs \
  --advid <advertiser-id> --adid <plan-id> \
  --pt liveproduct --surface live_global \
  --start YYYY-MM-DD --end YYYY-MM-DD
```

Store-global with official/staff/creator videos:

```bash
cd <skill-directory>
node scripts/run_backend_material_add.mjs \
  --advid <advertiser-id> --adid <plan-id> \
  --pt videopoi --surface store_global \
  --start YYYY-MM-DD --end YYYY-MM-DD --include-staff
```

Omit `--include-staff` for official-only store requests. The default is preview-only. After checking the plan identity and candidate set, append `--execute --confirm-plan-id <plan-id>` to perform the addition.

Accept completion only with `status=verified`, `readbackMissing=[]`, and `oldMaterialMissing=[]`. For store-global also require `storePoiSetUnchanged=true` and identical `beforePoiIds`/`afterPoiIds`. `appendCount=0` is successful only after every eligible exact ID is read back. Stop on an exact assertion; do not invent staff product-ID requirements for live-global.
