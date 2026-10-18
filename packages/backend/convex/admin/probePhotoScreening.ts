"use node";

import { Jimp } from "jimp";
import { internalAction } from "../_generated/server";
import { ingestToAxiom } from "../lib/axiom";
import { logEvent } from "../lib/logEvent";
import {
  makeModerationPortFromEnv,
  readScreeningConfig,
} from "../library/adapters/photoModeration";

// Post-deploy check that photo screening really works on this deployment: classifies a generated,
// plain grey 64x64 JPEG (no user data) through the configured port and returns the outcome —
// "scored" with an nsfw score means the token, the router endpoint and the model all work. Never
// returns or logs the token value. Run by an operator:
//   npx convex run admin/probePhotoScreening:probePhotoScreening        (dev)
//   npx convex run --prod admin/probePhotoScreening:probePhotoScreening (prod)
export const probePhotoScreening = internalAction({
  args: {},
  handler: async () => {
    const config = readScreeningConfig(process.env);
    const image = new Jimp({ width: 64, height: 64, color: 0x808080ff });
    const bytes = new Uint8Array(await image.getBuffer("image/jpeg"));
    const result = await makeModerationPortFromEnv(process.env).classify(
      bytes,
      "image/jpeg",
    );
    const report = {
      config_status: config.status,
      provider: config.provider,
      model: config.model,
      endpoint: config.endpoint,
      token_configured: config.tokenConfigured,
      screening_outcome: result.outcome,
      status: result.status,
      unscored_reason: result.reason,
      http_status: result.httpStatus,
      nsfw_score: result.score,
    };
    await ingestToAxiom(
      logEvent({
        event: "admin.probePhotoScreening",
        outcome: result.outcome === "scored" ? "success" : "error",
        ...report,
      }),
    );
    return report;
  },
});
