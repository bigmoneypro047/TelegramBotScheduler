import pg from "pg";
import { log } from "./index";

const SEED_BOTS = [
  { name: "Userbot 1", phone_number: "+2349150827155", session_string: "1BJWap1sBu6MKU677egmvEFal_M_o07g2fFCqAZJh2y3V_UirlolpOqsQEV9ThQKBsqBlchYSgMci47rlN0Gy64Bvp_E3AkBhce2GOzZI-kfo1SzLY5kjCA4aB08gXaHm1aQptvw4yIDhYsMYGH8YNX2O7p7VKiHxp6ZH-QghNQO2H3b0TzX-uMOJpNh_6g6fgi5O3-Nfvlwk5SlH3jTx7NSB8r9kF6r0mAmbdKrFa0Kpt0nHZjpOIcU814fIoKEm1lfOZnP8RYigtX0_8MgoQOeiZMeDg-ht-Hc5FrmIn6BCVrIfYyPwxGJvf_S43qpnr-QJBERKDoSdDas0ACfyNDX4shC2wOw=", api_id: "32144331", api_hash: "2ef193802cea24d865f591f01456c1f1", bot_order: 1 },
  { name: "Userbot 2", phone_number: "+2348154110274", session_string: "1BJWap1wBu3ACx1i9S8hnglLF6lMZ5gaWLhpvK3ILvoQCo1MGTt8tqL6lwD3fualKmciA0uyv62liu4qFpJXj2V_bPqlupWHmqhfZmNrzEEkmBvOAEaLFpX1vH0G-ZtI1aEt_WVDO6gEXjZ1ahjFZGc_bn-tTC_Y-cUCIDLJnA_EXMwUM-qD4VfqXUo_bRO_Tl7ewKGLcFr8_ujnuqcBU4vljqmHCWjvgErG9CnChKmxmargfbC6tPflFgcKmYgjbj-BhZzfaupyD_fy7L_97m1roTTjDS5kW1m4W50V13s_bFIMOuDdCdn1_LoT96Gng-bwhS74aIBTE4e4FMXQJa7NO2wgGHTI=", api_id: "35692817", api_hash: "b28e22256aa26bc9e7d8703bd541a927", bot_order: 2 },
  { name: "Userbot 3", phone_number: "+2348120347544", session_string: "1BJWap1wBu5unWluTT4csbTNDf4DAT9qE_iCUGrLtTD6C1zUy-5740dOan2ohitH5gouywMHXLXxnJ6g-koxYKfHOcS1eF1_oiiYBku4m0B2WdSX0I-qR4zHhkAroC1V8eBl0IO9E92n3bJxu7ZEJYugO9CJyVQqL49WkLM2D4vetei8Lv_D4LiGjvSHXW3tDttZgCQON4GJr9Eqp1omXgh68l3Wv1XfsMJAdQkx0FJkqe5vVUovKrEAzZjPvNEwapi6XQH4D70ibewfB9Lmbj7OvDq9qv2WXRWfv5685n040czzIuiTn1qM3demTCRXagErGenWG45kcWU1xmuOd2MopQEryBOc=", api_id: "33167458", api_hash: "eca8dbf21be430d6aabd768bc6db6269", bot_order: 3 },
  { name: "Userbot 4", phone_number: "+2348053901725", session_string: "1BJWap1wBu5AeE-Rh_OPYSyPblzqDft9_N7z-UaAV0MeDve88mPTiq0MvisEani1-i96cliGwF68JVbUG64L3FCYOxPL27KtrkKL1trmWEz0vB-RhyxWzfKh1YaMYQfyFBHltih2an6IufPjjue0k3787zy-Sh7Jm6dOOD-azlCgOguy1Zvg5dbHWCvlJXNrxlbeylxmrpAe25_ecooGRY_goD0fJdgBLDYluW9sNWVtVSUWFYIaUAwOGPSljnqXkTLfPGmyiZ1MDLKQjlaRdETNZKPsh9S8szWA6ZxEaVL0sXK67OCmoquuGHog4qSu1HB2TIkN50thxstgfhOKWtl7S97uJUtc=", api_id: "38322357", api_hash: "16d460e7bfbf8d783992490ccadda270", bot_order: 4 },
  { name: "Userbot 5", phone_number: "+2348067467944", session_string: "1BJWap1sBu52_aA5bS_hm48sRx9eNd59Mqzg3lVtqr-XHM-kQvoUEXiSZ3E0N2eFext7O8KQRWUXSqV9hd4qPh1Epk1KwCtEQTY249QbJtkkS0p5h-8ehYi60cKWrFTntxt3fUFO2N3RGbdkfX23tTz3aky4BuKPT8U2ZOjlQZ5GV7kwP5CUoHqbu375-rKytY1DcmaZahJRCPwAunj7LWMFIOiYn8LLQUibyjjojuBf5L6S97GZpH2mOLklwUkFDcC52cEq1eNOC3_1xY8Bh-KCOAd-wtaP9JmjzpxdAJkjWWAdWURSkgDfZQj2ghrXXCd1gn2YZWgXgZtRastrTh10cwl3bVs8=", api_id: "35647330", api_hash: "b69936a91af1b27d1e5008980052853e", bot_order: 5 },
  { name: "Userbot 6", phone_number: "+2349051172210", session_string: "1BJWap1sBu0Oyv-9T8ZEP8cBZYooYL8j0AfRkIx9zQSTuHjSDozMKWyHLQKxaUzdYPotvS7QO-t5eb7OemXI9LooTpMxlUAWGsYHTh_iU91cnOCuK3BrsKs-fSVLLUb3jzbAtKEbEMd-KJQtK0xrAkkAh9Nvu659P50bxKgQp9o21pJq5aqXobAN9sIyWVTUBg2wFOCGMCCtqGIzyBQlJgwJA8SGlDpYCggv8-wrpquIAEfA_u5ShVygiHv_h504kzsIDAaeFHVoBvWoFN_GyLwDOchyx8rgSQ8Vkzmhypp-wWoTlS6Vt8gyPMPhgTHYLH2JkGkmaeRF0zaPM1mREcRZeBoc1g4g=", api_id: "39865808", api_hash: "b7c39dd57f811949d65efd9393e2e295", bot_order: 6 },
];

const SEED_GROUPS = [
  { name: "GA VIP Group 3", group_id: "-1003888492713", group_order: 1 },
  { name: "GA Signal Group II", group_id: "-1003706903145", group_order: 2 },
  { name: "GA Signal Group 444", group_id: "-1002860574543", group_order: 3 },
  { name: "GA Discussion Group", group_id: "-1003542765160", group_order: 4 },
  { name: "GA NewComer Welcome Group II", group_id: "-1003780664837", group_order: 5 },
];

const SEED_BOT_CONFIG = {
  bot_token: "8460790867:AAEwHAqTdAFTHXAq2zgw4x9ndngF3Ua34uU",
  is_active: true,
};

export async function seedDatabaseIfEmpty(): Promise<void> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();

    const botsCount = await client.query("SELECT COUNT(*) as total FROM userbots");
    const groupsCount = await client.query("SELECT COUNT(*) as total FROM groups");

    const hasBots = parseInt(botsCount.rows[0].total) > 0;
    const hasGroups = parseInt(groupsCount.rows[0].total) > 0;

    if (hasBots && hasGroups) {
      log(`DB seed check: ${botsCount.rows[0].total} bots, ${groupsCount.rows[0].total} groups — no seeding needed`, "seed");
      await client.end();
      return;
    }

    log("DB seed: Tables are empty — seeding production data...", "seed");

    if (!hasBots) {
      for (const bot of SEED_BOTS) {
        await client.query(
          `INSERT INTO userbots (id, name, phone_number, session_string, api_id, api_hash, is_active, bot_order)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true, $6)
           ON CONFLICT DO NOTHING`,
          [bot.name, bot.phone_number, bot.session_string, bot.api_id, bot.api_hash, bot.bot_order]
        );
      }
      log(`DB seed: Inserted ${SEED_BOTS.length} userbots`, "seed");
    }

    if (!hasGroups) {
      for (const group of SEED_GROUPS) {
        await client.query(
          `INSERT INTO groups (id, name, group_id, group_order, is_active)
           VALUES (gen_random_uuid(), $1, $2, $3, true)
           ON CONFLICT DO NOTHING`,
          [group.name, group.group_id, group.group_order]
        );
      }
      log(`DB seed: Inserted ${SEED_GROUPS.length} groups`, "seed");
    }

    const configCount = await client.query("SELECT COUNT(*) as total FROM bot_config");
    if (parseInt(configCount.rows[0].total) === 0) {
      await client.query(
        `INSERT INTO bot_config (id, bot_token, is_active, created_at)
         VALUES (gen_random_uuid(), $1, $2, NOW())`,
        [SEED_BOT_CONFIG.bot_token, SEED_BOT_CONFIG.is_active]
      );
      log("DB seed: Inserted bot_config", "seed");
    }

    await client.end();
    log("DB seed: Complete — production data is ready", "seed");
  } catch (err: any) {
    log(`DB seed error: ${err.message}`, "seed");
    try { await client.end(); } catch {}
  }
}
