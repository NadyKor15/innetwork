// Classic Alexa custom skill "In Network": the mom's checkup year on a real Echo Show (SPEC §6.4, narrow on purpose).
// A thin MCP client of the InNetwork server: the skill speaks the tool's own line and renders the tool's card as APL.
// Only the adult's own plan is on the device: no children's searches, no ages (skills policy §2/§3; SPEC §6.4).
import { SkillBuilders, getIntentName, getRequestType, getSupportedInterfaces, type HandlerInput, type RequestHandler, type ErrorHandler } from "ask-sdk-core";
import { checkupDocument, type CheckupCard } from "./apl.ts";
import type { InNetwork } from "./mcp.ts";

export const TEXT = {
  help: "You can say: what's next on my checkup plan.",
  reprompt: "You can say: what's next on my checkup plan.",
  goodbye: "Okay.",
  fallback: "Sorry, I didn't get that. You can say: what's next on my checkup plan.",
  timeout: "InNetwork didn't answer in time. Please try again.",
  error: "InNetwork had a problem. Please try again in a moment.",
};
const APL = "Alexa.Presentation.APL";
const escapeSsml = (s: string) => s.replace(/&/g, "and").replace(/[<>]/g, " ");
const sessionKey = (h: HandlerInput) => h.requestEnvelope.session?.sessionId ?? "no-session";
const hasScreen = (h: HandlerInput) => !!getSupportedInterfaces(h.requestEnvelope)?.[APL];

export function buildSkill(deps: { innetwork: InNetwork; skillId?: string }) {
  const inn = deps.innetwork;

  async function speakTool(h: HandlerInput, tool: string, args: Record<string, unknown>, keepOpen = true) {
    const out = await inn.call(sessionKey(h), tool, args);
    const rb = h.responseBuilder;
    if (out.kind === "ok") {
      rb.speak(escapeSsml(out.text));
      const card = out.structured?.card as (CheckupCard & { view?: string }) | undefined;
      if (hasScreen(h) && card?.view === "checkup-year") {
        rb.addDirective({ type: `${APL}.RenderDocument`, token: "innetwork-checkup", document: checkupDocument(), datasources: { payload: { card } } } as never);
      }
      // consent first: the server says so, the parent answers "allow"
      if (out.structured?.data?.consentRequired) { rb.reprompt("Say allow to continue."); return rb.getResponse(); }
    } else rb.speak(out.kind === "timeout" ? TEXT.timeout : TEXT.error);
    if (keepOpen) rb.reprompt(TEXT.reprompt);
    return rb.getResponse();
  }

  const Launch: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "LaunchRequest",
    handle: (h) => speakTool(h, "checkup_year", { action: "status" }),
  };
  const Status: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "IntentRequest" && getIntentName(h.requestEnvelope) === "CheckupStatusIntent",
    handle: (h) => speakTool(h, "checkup_year", { action: "status" }),
  };
  const Allow: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "IntentRequest" && getIntentName(h.requestEnvelope) === "AllowIntent",
    handle: async (h) => { await inn.call(sessionKey(h), "consent", { action: "allow" }); return speakTool(h, "checkup_year", { action: "status" }); },
  };
  const Help: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "IntentRequest" && getIntentName(h.requestEnvelope) === "AMAZON.HelpIntent",
    handle: (h) => h.responseBuilder.speak(TEXT.help).reprompt(TEXT.reprompt).getResponse(),
  };
  const Stop: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "IntentRequest" && ["AMAZON.StopIntent", "AMAZON.CancelIntent", "AMAZON.NavigateHomeIntent"].includes(getIntentName(h.requestEnvelope)),
    handle: (h) => h.responseBuilder.speak(TEXT.goodbye).withShouldEndSession(true).getResponse(),
  };
  const Fallback: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "IntentRequest" && getIntentName(h.requestEnvelope) === "AMAZON.FallbackIntent",
    handle: (h) => h.responseBuilder.speak(TEXT.fallback).reprompt(TEXT.reprompt).getResponse(),
  };
  const Ended: RequestHandler = {
    canHandle: (h) => getRequestType(h.requestEnvelope) === "SessionEndedRequest",
    handle: (h) => h.responseBuilder.getResponse(),
  };
  const Errors: ErrorHandler = {
    canHandle: () => true,
    handle: (h, e) => { console.error("[skill] error", e); return h.responseBuilder.speak(TEXT.error).reprompt(TEXT.reprompt).getResponse(); },
  };
  const b = SkillBuilders.custom().addRequestHandlers(Launch, Status, Allow, Help, Stop, Fallback, Ended).addErrorHandlers(Errors);
  if (deps.skillId) b.withSkillId(deps.skillId);
  return b.create();
}
