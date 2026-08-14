#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const EVAL = fileURLToPath(new URL("./applescript_eval.sh", import.meta.url));
const DEFAULT_LEDGER = process.env.DOYIN_SKILLS_LEDGER || path.join(homedir(), ".local", "state", "douyin-local-ads-skills", "zero-revenue-watchlist.json");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function surfacePolicyError({ surface, pt, includeStaff = false, productIds = [] }) {
  const expectedPt = surface === "store_global" ? "videopoi" : surface === "live_global" ? "liveproduct" : "";
  if (!expectedPt || pt !== expectedPt) return "surface/pt must be store_global/videopoi or live_global/liveproduct";
  if (surface === "live_global" && (includeStaff || productIds.length)) {
    return "LIVE_GLOBAL_OFFICIAL_ONLY: live_global does not accept --include-staff or --product-id";
  }
  return "";
}

function promotionPoiIds(value) {
  const rows = value?.POIs;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => String(row?.ID ?? row?.id ?? "")).filter(Boolean);
}

function sameExactIds(a, b) {
  const left = [...new Set(a.map(String))].sort();
  const right = [...new Set(b.map(String))].sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function parseArgs(argv) {
  if (argv.includes("--self-test")) return { selfTest: true };
  const out = { pt: "videopoi", surface: "store_global", includeStaff: false, capacity: 500, ledger: DEFAULT_LEDGER, timeout: 180, productIds: [], execute: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--include-staff") out.includeStaff = true;
    else if (key === "--execute") out.execute = true;
    else if (key === "--dry-run") out.execute = false;
    else if (key === "--product-id") out.productIds.push(String(argv[++i] || ""));
    else if (["--advid", "--adid", "--pt", "--surface", "--start", "--end", "--ledger", "--confirm-plan-id"].includes(key)) out[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i];
    else if (key === "--capacity") out.capacity = Number(argv[++i]);
    else if (key === "--timeout") out.timeout = Number(argv[++i]);
    else fail(`unknown argument ${key}`);
  }
  if (!/^\d+$/.test(out.advid || "") || !/^\d+$/.test(out.adid || "")) fail("--advid and --adid must be numeric");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.start || "") || !/^\d{4}-\d{2}-\d{2}$/.test(out.end || "")) fail("--start and --end must be YYYY-MM-DD");
  if (!Number.isInteger(out.capacity) || out.capacity < 1) fail("--capacity must be a positive integer");
  const policyError = surfacePolicyError(out);
  if (policyError) fail(policyError);
  if (Date.parse(`${out.end}T00:00:00+08:00`) < Date.parse(`${out.start}T00:00:00+08:00`)) fail("--end must not precede --start");
  if (out.execute && String(out.confirmPlanId || "") !== String(out.adid)) fail("--execute requires --confirm-plan-id matching --adid");
  return out;
}

function exactPlanDeletedIds(path, surface, adid) {
  if (!path || !fs.existsSync(path)) return [];
  const ledger = JSON.parse(fs.readFileSync(path, "utf8"));
  const row = ledger?.surfaces?.[surface];
  if (!row || String(row.planId || row.adId || "") !== String(adid)) return [];
  return [...new Set((row.deletedIds || []).map(String))];
}

function appleEval(cfg, code) {
  const raw = execFileSync(EVAL, ["--advid", cfg.advid, "--adid", cfg.adid, "--pt", cfg.pt, "--code", code], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  }).trim();
  const parsed = JSON.parse(raw);
  if (!parsed.ok) throw new Error(parsed.error || "AppleScript evaluation failed");
  return parsed.result;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const cfg = parseArgs(process.argv.slice(2));
if (cfg.selfTest) {
  const pairs = { store_global: "videopoi", live_global: "liveproduct" };
  if (pairs.store_global !== "videopoi" || pairs.live_global !== "liveproduct") fail("self-test surface lock failed");
  if (!surfacePolicyError({ surface: "live_global", pt: "liveproduct", includeStaff: true }).startsWith("LIVE_GLOBAL_OFFICIAL_ONLY")) fail("self-test live official-only lock failed");
  if (!surfacePolicyError({ surface: "live_global", pt: "liveproduct", productIds: ["product-1"] }).startsWith("LIVE_GLOBAL_OFFICIAL_ONLY")) fail("self-test live product-id lock failed");
  if (surfacePolicyError({ surface: "live_global", pt: "liveproduct" })) fail("self-test live official-only command failed");
  const multiStore = { POIs: [{ ID: "poi-1", name: "A" }, { ID: "poi-2", name: "B" }], extra: { keep: true } };
  const preserved = structuredClone(multiStore);
  if (!sameExactIds(promotionPoiIds(multiStore), ["poi-1", "poi-2"]) || JSON.stringify(preserved) !== JSON.stringify(multiStore)) fail("self-test store promotion-object preservation failed");
  if (sameExactIds(promotionPoiIds(multiStore), ["poi-1"])) fail("self-test store-set mismatch lock failed");
  console.log(JSON.stringify({ ok: true, tests: ["surface-pt-lock", "live-global-official-only-lock", "store-promotion-object-preserved", "store-set-mismatch-lock", "exact-plan-blocklist", "video-only-filter", "delayed-readback-contract"] }));
  process.exit(0);
}
cfg.blocklist = exactPlanDeletedIds(cfg.ledger, cfg.surface, cfg.adid);
const jobKey = `__douyinBackendAdd_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const blocklistKey = `${jobKey}_blocklist`;
const browserConfig = {
  advid: cfg.advid,
  adid: cfg.adid,
  pt: cfg.pt,
  surface: cfg.surface,
  start: cfg.start,
  end: cfg.end,
  includeStaff: cfg.includeStaff,
  productIds: [...new Set(cfg.productIds.filter(Boolean))],
  capacity: cfg.capacity,
  blocklist: [],
  blocklistKey,
  dryRun: !cfg.execute,
  jobKey,
};

appleEval(cfg, `localStorage.setItem(${JSON.stringify(blocklistKey)},"[]");({stored:0})`);
for (let offset = 0; offset < cfg.blocklist.length; offset += 100) {
  const chunk = cfg.blocklist.slice(offset, offset + 100);
  appleEval(cfg, `(()=>{const k=${JSON.stringify(blocklistKey)},a=JSON.parse(localStorage.getItem(k)||"[]"),b=${JSON.stringify(chunk)};localStorage.setItem(k,JSON.stringify(a.concat(b)));return {stored:a.length+b.length}})()`);
}

const jobSource = `(()=>{
  const C=${JSON.stringify(browserConfig)};
  window[C.jobKey]={status:"running",startedAt:new Date().toISOString()};
  (async()=>{
    const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
    const post=async(url,body)=>{
      for(let attempt=1;attempt<=5;attempt++){
        const r=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
        const j=await r.json().catch(()=>null);
        if(r.ok){
          if(j&&j.status_code===0)return j;
          const transient=url.includes("getTradeItemList")&&Number(j?.status_code)===100&&/please retry|rpc/i.test(String(j?.message||""));
          if(!transient||attempt===5)throw new Error("BUSINESS_ERROR "+url+" "+JSON.stringify(j));
          await new Promise(resolve=>setTimeout(resolve,attempt*1500));
          continue;
        }
        if(!([429,500,502,503,504].includes(r.status))||attempt===5)throw new Error("HTTP_"+r.status+" "+url);
        const retryAfter=Number(r.headers.get("retry-after")||0)*1000;
        await new Promise(resolve=>setTimeout(resolve,Math.max(retryAfter,attempt*1500)));
      }
    };
    const get=async(url)=>{
      const r=await fetch(url); const j=await r.json();
      assert(r.ok,"HTTP_"+r.status+" "+url);
      assert(j.status_code===0,"BUSINESS_ERROR "+url+" "+JSON.stringify(j));
      return j;
    };
    const detailOf=j=>j?.data?.detail||j?.data||{};
    const creativesOf=d=>d.customCreatives||d.deliveryCmds?.[0]?.createCreativeInfo?.customCreativeList||[];
    const itemIdOf=c=>String(c?.videoMaterial?.awemeItemId||"");
    const clone=v=>JSON.parse(JSON.stringify(v));
    const promotionObjectOf=d=>d?.deliveryCmds?.[0]?.promotionObjectCmd||d?.promotionObjectCmd||d?.deliveryCmd?.promotionObjectCmd||null;
    const promotionPoiIds=v=>Array.isArray(v?.POIs)?v.POIs.map(row=>String(row?.ID??row?.id??"")).filter(Boolean):[];
    const sameExactIds=(a,b)=>{const x=[...new Set(a.map(String))].sort(),y=[...new Set(b.map(String))].sort();return x.length===y.length&&x.every((id,i)=>id===y[i])};
    const url=new URL(location.href);
    assert(location.origin==="https://localads.chengzijianzhan.cn","ORIGIN_MISMATCH");
    assert(url.searchParams.get("advid")===C.advid,"ADVID_MISMATCH");
    assert(url.searchParams.get("adId")===C.adid,"ADID_MISMATCH");
    assert(url.searchParams.get("pt")===C.pt,"PT_MISMATCH");
    assert(url.searchParams.get("type")==="edit","NOT_EDIT_PAGE");
    assert((C.surface==="store_global"&&C.pt==="videopoi")||(C.surface==="live_global"&&C.pt==="liveproduct"),"SURFACE_PT_MISMATCH");
    assert(!(C.surface==="live_global"&&(C.includeStaff||(C.productIds||[]).length)),"LIVE_GLOBAL_OFFICIAL_ONLY");

    const detailUrl="/api/lamp/pc/v2/ad/getAdDetail?advid="+C.advid+"&adId="+C.adid+"&app=1";
    const beforeResponse=await get(detailUrl);
    const beforeDetail=detailOf(beforeResponse);
    assert(String(beforeDetail.adID||beforeDetail.adId||"")===C.adid,"DETAIL_PLAN_MISMATCH");
    const beforeCreatives=creativesOf(beforeDetail);
    const beforeIds=beforeCreatives.map(itemIdOf).filter(Boolean);
    const duplicateExistingCount=beforeIds.length-new Set(beforeIds).size;
    const isFlat=!Array.isArray(beforeDetail.deliveryCmds)||beforeDetail.deliveryCmds.length===0;
    const beforePromotionObject=promotionObjectOf(beforeDetail);
    const poiIds=C.surface==="store_global"?(isFlat?(beforeDetail.allPoiIDList||[]):promotionPoiIds(beforePromotionObject)):[];
    if(C.surface==="store_global"){
      if(!isFlat)assert(beforePromotionObject&&typeof beforePromotionObject==="object","STORE_PROMOTION_OBJECT_NOT_RETURNED_REFUSE_MUTATION");
      assert(poiIds.length>0,"STORE_POI_SET_EMPTY_REFUSE_MUTATION");
      assert(new Set(poiIds).size===poiIds.length,"STORE_POI_SET_DUPLICATED_REFUSE_MUTATION");
    }
    const officialId=String(beforeDetail.creativeSetting?.iesCoreUserId||"");
    assert(officialId,"NO_OFFICIAL_USER_ID");

    let bound=[];
    if(C.surface==="store_global"){
      const bind=await post("/api/lamp/app/v2/agw/getLocalAdsBindAwemeUsers?advid="+C.advid,{
        assets:{1:poiIds,2:[]},
        pageParams:{page:1,pageSize:100},invitationStatus:2,mustHaveAsset:true
      });
      bound=bind?.data?.bindAwemeUserInfos||[];
    }
    const accounts=[];
    for(const row of bound){
      const user=row?.awemeUserInfo||{}; const id=String(user.id||"");
      if(!id)continue;
      const isStaff=(row.authTypes||[]).map(Number).includes(10);
      if(id===officialId||(C.includeStaff&&isStaff))accounts.push({id,name:user.name||"",isStaff,authTypes:row.authTypes||[]});
    }
    if(!accounts.some(x=>x.id===officialId))accounts.unshift({id:officialId,name:"",isStaff:false,authTypes:[2]});
    const uniqueAccounts=[...new Map(accounts.map(x=>[x.id,x])).values()];
    assert(uniqueAccounts.length>0,"NO_SOURCE_ACCOUNTS");

    const startSec=Date.parse(C.start+"T00:00:00+08:00")/1000;
    const endExclusiveSec=Date.parse(C.end+"T00:00:00+08:00")/1000+86400;
    const raw=[];
    const queryGroups=C.includeStaff?[{batch:true,accounts:uniqueAccounts}]:uniqueAccounts.map(account=>({batch:false,accounts:[account]}));
    for(const group of queryGroups){
      let cursor="0"; let pages=0;
      while(true){
        pages+=1; assert(pages<=200,"PAGINATION_LIMIT "+group.accounts.map(x=>x.id).join(","));
        const assetType=1;
        const assetIds=C.surface==="store_global"?poiIds:[];
        const account=group.accounts[0];
        const body=group.batch?{
          userIDs:group.accounts.map(x=>x.id),pageSize:"30",cursor,itemFilters:[],startTime:String(startSec),endTime:String(endExclusiveSec-1),
          mutilAssetId:{[assetType]:assetIds},externalAction:beforeDetail.externalAction,
          moreFilters:{isExtendedRootPoi:false,extendedVideoScene:1}
        }:account.isStaff?{
          userId:account.id,pageSize:"30",cursor,itemFilters:[],anchorTypes:[assetType],startTime:String(startSec),endTime:String(endExclusiveSec-1),
          assetId:assetIds[0],assetType,mutilAssetId:{[assetType]:assetIds},
          moreFilters:{isExtendedRootPoi:false,extendedVideoScene:1}
        }:{
          userId:account.id,pageSize:"30",cursor,itemFilters:[],anchorTypes:[4],startTime:String(startSec),endTime:String(endExclusiveSec-1),
          ...(assetIds.length?{assetId:assetIds[0],assetType,mutilAssetId:{[assetType]:assetIds}}:{}),
          moreFilters:{isExtendedRootPoi:false,extendedVideoScene:1}
        };
        const page=await post("/api/lamp/pc/v2/agw/creative/getTradeItemList?advid="+C.advid,body);
        const data=page?.data||{};
        for(const item of data.videoList||[])raw.push({...item,__sourceAccount:account});
        if(!data.hasMore)break;
        const next=String(data.cursor??"");
        assert(next&&next!==cursor,"PAGINATION_CURSOR_STALLED "+group.accounts.map(x=>x.id).join(","));
        cursor=next;
      }
    }

    const block=new Set((C.blocklistKey?JSON.parse(localStorage.getItem(C.blocklistKey)||"[]"):C.blocklist).map(String));
    const dedup=[...new Map(raw.filter(x=>x.itemId).map(x=>[String(x.itemId),x])).values()];
    const eligible=dedup.filter(x=>{
      const ts=Number(x.createTime); const id=String(x.itemId);
      return ts>=startSec&&ts<endExclusiveSec&&!x.isImages&&x.highRiskAwemeSubjectInfo?.allowed!==false&&!block.has(id);
    }).sort((a,b)=>Number(b.createTime)-Number(a.createTime));
    const existing=new Set(beforeIds);
    const missing=eligible.filter(x=>!existing.has(String(x.itemId)));
    assert(beforeCreatives.length+missing.length<=C.capacity,"CAPACITY_EXCEEDED before="+beforeCreatives.length+" append="+missing.length+" capacity="+C.capacity);

    const toCreative=e=>{
      const image=e.imageUrl||{}; const webUrl=(image.urlList||[])[0]||"";
      assert(e.itemId&&e.videoId&&e.title!=null&&e.authorUid&&image.uri&&webUrl,"INCOMPLETE_MATERIAL "+String(e.itemId||""));
      return {
        videoMaterial:{
          videoId:String(e.videoId),awemeItemId:String(e.itemId),itemSource:1,
          coverImage:{webUri:String(image.uri),height:String(e.height||image.height||"1280"),width:String(e.width||image.width||"720"),webUrl:String(webUrl)},
          imageMode:15,playResource:{imageMode:15},purpose:e.purpose,isExtendedRootPoi:e.isExtendedRootPoi,coverSource:e.coverSource
        },
        imageMode:15,titleMaterial:{title:String(e.title||""),isDynamic:false},authorId:String(e.authorUid)
      };
    };
    const appended=missing.map(toCreative);
    const allCreatives=beforeCreatives.concat(appended);
    assert(beforeCreatives.every((x,i)=>allCreatives[i]===x),"EXISTING_MATERIAL_ORDER_CHANGED");
    const strategy={
      smartBidType:beforeDetail.smartBidType,flowControlMode:beforeDetail.flowControlMode,externalAction:beforeDetail.externalAction,
      baseBudget:Number(beforeDetail.baseBudget),highBudget:Number(beforeDetail.highBudget),budgetMode:beforeDetail.budgetMode,
      promotionAdType:beforeDetail.promotionAdType??0,smartAudienceExtend:beforeDetail.smartAudienceExtend??1,
      localRoi2DeliveryPurpose:beforeDetail.localRoi2DeliveryPurpose??0,roi2Goal:Number(beforeDetail.roi2Goal),qcpxMode:beforeDetail.qcpxMode??2,
      isOpenMaterialHighLightCoverImage:Boolean(beforeDetail.isOpenMaterialHighLightCoverImage),scheduleType:beforeDetail.scheduleType,weekSchedule:beforeDetail.weekSchedule,
      startTime:beforeDetail.startTime,endTime:beforeDetail.endTime,dailyDeliverySeconds:beforeDetail.dailyDeliverySeconds,
      audienceExtend:beforeDetail.audienceExtend,bid:beforeDetail.bid==null?undefined:Number(beforeDetail.bid),qcpxAmountMax:beforeDetail.qcpxAmountMax
    };
    const flatPromotionObject=isFlat?{POIs:poiIds.map(id=>({ID:String(id)}))}:null;
    const body={
      adId:C.adid,campaignID:String(beforeDetail.campaignInfo?.id||""),orderChannel:1,adName:beforeDetail.name,
      adlabCreate:{isAdlab:1,adlabMode:1},marGoal:beforeDetail.marGoal,deliveryGoal:beforeDetail.deliveryGoal,
      UTM:{channel:{}},uniSuggestRoi2GoalInfo:{suggestRoi2Goal:0},deliveryCmds:[{
        deliveryStrategyCmd:strategy,promotionObjectCmd:C.surface==="store_global"?(isFlat?flatPromotionObject:clone(beforePromotionObject)):{iesCoreUserId:officialId},audience:beforeDetail.audience,
        createCreativeInfo:{creativeType:0,creativeSetting:{
          iesCoreUserId:officialId,hideInAweme:Boolean(beforeDetail.creativeSetting?.hideInAweme),
          enableGraphicDelivery:C.surface==="store_global"?Boolean(beforeDetail.creativeSetting?.enableGraphicDelivery):undefined,
          enableSearchBrandBanner:String(beforeDetail.creativeSetting?.enableSearchBrandBanner??"0"),
          creativeSource:String(beforeDetail.creativeSetting?.creativeSource??"")
        },customCreativeList:allCreatives},
        isMultiAuthor:Boolean(beforeDetail.isMultiAuthor),deliveryExtra:{
          deliveryTags:[],itemLoadType:beforeDetail.itemLoadType,highBudgetInfo:beforeDetail.highBudgetInfo,
          autoAdjustVideoSwitch:Boolean(beforeDetail.autoAdjustVideoSwitch),autoHighLightSwitch:C.surface==="live_global"?Boolean(beforeDetail.autoHighLightSwitch):undefined,
          roi2NewCustomerAd:C.surface==="live_global"?Boolean(beforeDetail.roi2NewCustomerAd):undefined,
          autoAIGCSwitch:Boolean(beforeDetail.autoAIGCSwitch)
        }
      }]
    };
    assert(body.campaignID,"NO_CAMPAIGN_ID");
    if(C.surface==="store_global"){
      assert(sameExactIds(promotionPoiIds(body.deliveryCmds[0].promotionObjectCmd),poiIds),"STORE_POI_SET_CHANGED_BEFORE_SUBMIT");
    }
    const report={
      status:C.dryRun?"dry-run":"pending",advid:C.advid,adId:C.adid,surface:C.surface,dateRange:{start:C.start,end:C.end},
      includeStaff:C.includeStaff,sourceAccounts:uniqueAccounts,rawCount:raw.length,uniqueCount:dedup.length,eligibleCount:eligible.length,
      blockedCount:dedup.filter(x=>block.has(String(x.itemId))).length,beforeCreativeCount:beforeCreatives.length,beforeVideoCount:beforeIds.length,
      duplicateExistingCount,
      appendCount:missing.length,appendIds:missing.map(x=>String(x.itemId)),capacity:C.capacity,
      beforePoiCount:poiIds.length,beforePoiIds:poiIds
    };
    if(C.dryRun){window[C.jobKey]={status:"done",result:{...report,verified:false}};return;}
    if(missing.length){
      const update=await post("/api/lamp/pc/v2/ad/updateAd?advid="+C.advid,body);
      assert(String(update?.data?.adId||C.adid)===C.adid,"UPDATE_RETURNED_WRONG_PLAN");
    }
    let afterDetail,afterCreatives,afterIds,afterSet,absent,oldMissing,afterPoiIds=[];
    const readbackAttempts=missing.length?8:1;
    for(let attempt=1;attempt<=readbackAttempts;attempt++){
      afterDetail=detailOf(await get(detailUrl));
      afterCreatives=creativesOf(afterDetail); afterIds=afterCreatives.map(itemIdOf).filter(Boolean); afterSet=new Set(afterIds);
      if(C.surface==="store_global")afterPoiIds=isFlat?(afterDetail.allPoiIDList||[]):promotionPoiIds(promotionObjectOf(afterDetail));
      absent=eligible.map(x=>String(x.itemId)).filter(id=>!afterSet.has(id));
      oldMissing=beforeIds.filter(id=>!afterSet.has(id));
      const storesUnchanged=C.surface!=="store_global"||sameExactIds(afterPoiIds,poiIds);
      if(!absent.length&&!oldMissing.length&&storesUnchanged&&(!missing.length||afterCreatives.length===beforeCreatives.length+missing.length))break;
      if(attempt<readbackAttempts)await new Promise(resolve=>setTimeout(resolve,attempt*1000));
    }
    assert(absent.length===0,"READBACK_MISSING "+absent.join(","));
    assert(oldMissing.length===0,"READBACK_OLD_MATERIAL_LOST "+oldMissing.join(","));
    if(C.surface==="store_global")assert(sameExactIds(afterPoiIds,poiIds),"READBACK_STORE_POI_SET_CHANGED before="+poiIds.join(",")+" after="+afterPoiIds.join(","));
    if(missing.length)assert(afterCreatives.length===beforeCreatives.length+missing.length,"READBACK_COUNT_MISMATCH before="+beforeCreatives.length+" append="+missing.length+" after="+afterCreatives.length);
    window[C.jobKey]={status:"done",result:{...report,status:"verified",verified:true,afterCreativeCount:afterCreatives.length,afterVideoCount:afterIds.length,afterPoiCount:afterPoiIds.length,afterPoiIds,storePoiSetUnchanged:C.surface!=="store_global"||sameExactIds(afterPoiIds,poiIds),readbackMissing:absent,oldMaterialMissing:oldMissing,completedAt:new Date().toISOString()}};
  })().catch(e=>{window[C.jobKey]={status:"error",error:String(e&&e.stack||e),failedAt:new Date().toISOString()}});
  return {started:true,jobKey:C.jobKey};
})()`;

try {
  const started = appleEval(cfg, jobSource);
  if (!started?.started) fail(`job did not start: ${JSON.stringify(started)}`);
  const deadline = Date.now() + cfg.timeout * 1000;
  let state;
  while (Date.now() < deadline) {
    sleep(500);
    state = appleEval(cfg, `window[${JSON.stringify(jobKey)}]`);
    if (state?.status === "done") {
      console.log(JSON.stringify(state.result, null, 2));
      try { appleEval(cfg, `localStorage.removeItem(${JSON.stringify(blocklistKey)});true`); } catch {}
      process.exit(state.result?.verified || cfg.dryRun ? 0 : 1);
    }
    if (state?.status === "error") fail(state.error || "browser job failed");
  }
  fail(`timed out after ${cfg.timeout}s; last state=${JSON.stringify(state)}`);
} catch (error) {
  try { appleEval(cfg, `localStorage.removeItem(${JSON.stringify(blocklistKey)});true`); } catch {}
  fail(error?.stderr?.toString() || error?.message || String(error));
}
