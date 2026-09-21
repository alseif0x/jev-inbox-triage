import assert from "node:assert/strict";
import test from "node:test";

import {
  JevError,
  PHASE_B_QUESTIONS,
  THRESHOLDS,
  decide,
  gateDepth,
  gateVerdict,
  phaseAQuestions,
  triageItem,
} from "./jev.mjs";

// Nothing here touches the network: every test hands `decide` a fetch that
// answers from a fixture, so the rules are checked and the key is never used.
const LANES = { master: "Coordination", webforms: "Helpdesk" };

function answer(choice, confidence, probabilities = {}) {
  return { type: "choice", choice, confidence, probabilities };
}

function respond(bodies) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const next = bodies.shift();
    if (next instanceof Error) throw next;
    if (typeof next === "number") return { ok: next < 400, status: next, text: async () => "{}" };
    return { ok: true, status: 200, text: async () => JSON.stringify(next) };
  };
  return { fetchImpl, calls };
}

const phaseA = (depth, confidence, extra = {}) => ({
  model: "jev-1.13.0",
  answers: {
    depth: answer(depth, confidence, extra.probabilities),
    bot: answer("webforms", extra.botConfidence ?? 0.9),
    urgency: { type: "score", score: 1.2, confidence: 0.8 },
  },
  usage: { input_tokens: 300, output_tokens: 20 },
});

const phaseB = {
  model: "jev-1.13.0",
  answers: { effort: answer("a_fondo", 0.8), executor_tier: answer("default", 0.7) },
  usage: { input_tokens: 280, output_tokens: 12 },
};

test("a confident ignorar stays ignorar and asks nothing more", async () => {
  const { fetchImpl, calls } = respond([phaseA("ignorar", 0.92)]);
  const item = await triageItem({ state: "FYI newsletter", lanes: LANES, apiKey: "k", fetchImpl });
  assert.equal(item.depth, "ignorar");
  assert.equal(item.escalated, false);
  assert.equal(calls.length, 1, "Phase B must not run for a non-profundizar item");
  assert.equal(item.effort, undefined);
});

test("a coin-toss depth escalates one step and is marked", () => {
  assert.deepEqual(
    gateDepth(answer("ignorar", 0.34, { ignorar: 0.34, anotar: 0.33, profundizar: 0.33 })),
    { depth: "anotar", escalated: true },
  );
  assert.deepEqual(gateDepth(answer("anotar", 0.5)), { depth: "profundizar", escalated: true });
});

test("mass on profundizar forbids ignorar even when ignorar wins", () => {
  const gated = gateDepth(answer("ignorar", 0.65, { ignorar: 0.65, profundizar: 0.35 }));
  assert.equal(gated.depth, "anotar");
  assert.equal(gated.escalated, true);
});

test("escalation never moves away from the work", () => {
  assert.deepEqual(gateDepth(answer("profundizar", 0.2)), { depth: "profundizar", escalated: false });
});

test("profundizar runs Phase B with the same state and only Phase B's questions", async () => {
  const { fetchImpl, calls } = respond([phaseA("profundizar", 0.9), phaseB]);
  const item = await triageItem({ state: "Ticket 4411 blocked on client", lanes: LANES, apiKey: "k", fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].state, "Ticket 4411 blocked on client");
  assert.deepEqual(Object.keys(calls[1].questions), Object.keys(PHASE_B_QUESTIONS));
  assert.equal(item.effort, "a_fondo");
  assert.equal(item.executor_tier, "default");
  assert.equal(item.usage.length, 2);
});

test("a failed call keeps the item on the board as profundizar without a score", async () => {
  const { fetchImpl } = respond([503, 503]);
  const item = await triageItem({ state: "x", lanes: LANES, apiKey: "k", fetchImpl });
  assert.equal(item.depth, "profundizar");
  assert.equal(item.sinJev, true);
  assert.equal(item.error, "upstream");
});

test("timeouts and 5xx retry once; a 4xx is final", async () => {
  const ok = respond([503, phaseA("anotar", 0.9)]);
  const recovered = await decide({ state: "x", questions: phaseAQuestions(LANES), apiKey: "k", fetchImpl: ok.fetchImpl });
  assert.equal(recovered.answers.depth.choice, "anotar");
  assert.equal(ok.calls.length, 2);

  const rejected = respond([401, phaseA("anotar", 0.9)]);
  await assert.rejects(
    decide({ state: "x", questions: phaseAQuestions(LANES), apiKey: "k", fetchImpl: rejected.fetchImpl }),
    (error) => error instanceof JevError && error.code === "rejected",
  );
  assert.equal(rejected.calls.length, 1);
});

test("a label outside the criteria is a failed answer, not a coerced one", async () => {
  const bad = phaseA("maybe", 0.9);
  const { fetchImpl } = respond([bad]);
  await assert.rejects(
    decide({ state: "x", questions: phaseAQuestions(LANES), apiKey: "k", fetchImpl }),
    (error) => error.code === "invalid_response",
  );
});

test("a weak enviar becomes retocar and no_mandar is never softened", () => {
  assert.deepEqual(gateVerdict(answer("enviar", 0.55)), { verdict: "retocar", escalated: true });
  assert.deepEqual(gateVerdict(answer("enviar", 0.9)), { verdict: "enviar", escalated: false });
  assert.deepEqual(gateVerdict(answer("no_mandar", 0.1)), { verdict: "no_mandar", escalated: false });
});

test("the lane is tentative below its threshold", async () => {
  const { fetchImpl } = respond([phaseA("anotar", 0.9, { botConfidence: THRESHOLDS.laneConfidence - 0.1 })]);
  const item = await triageItem({ state: "x", lanes: LANES, apiKey: "k", fetchImpl });
  assert.equal(item.botTentative, true);
});

test("the recipe's schemas match what the API accepts", () => {
  const questions = phaseAQuestions(LANES);
  assert.equal(questions.depth.type, "choice");
  assert.ok(!Array.isArray(questions.depth.criteria), "choice criteria are a map");
  assert.equal(questions.urgency.type, "score");
  assert.ok(Array.isArray(questions.urgency.criteria), "score criteria are an ordered array");
  assert.deepEqual(questions.bot.criteria, LANES);
});

test("a missing key fails before any request", async () => {
  const { fetchImpl, calls } = respond([]);
  await assert.rejects(
    decide({ state: "x", questions: phaseAQuestions(LANES), apiKey: "", fetchImpl }),
    (error) => error.code === "missing_key",
  );
  assert.equal(calls.length, 0);
});
