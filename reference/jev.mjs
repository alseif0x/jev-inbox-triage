// Reference client for the recipe in SKILL.md. No dependencies, Node 18+.
//
// A host can copy this file or reimplement it; what matters is that the rules
// SKILL.md states in prose exist here as code that can be tested: one state per
// call, a bounded request, a timeout with one retry, an answer that is checked
// against the questions before anyone acts on it, and confidence thresholds
// that only ever escalate.

export const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
export const DEFAULT_MODEL = "jev-latest";

// Tune these after a few boards. They are the only place the numbers live.
export const THRESHOLDS = Object.freeze({
  depthConfidence: 0.6, // below this, depth escalates one step
  profundizarFloor: 0.3, // this much mass on profundizar forbids ignorar
  sendConfidence: 0.7, // an `enviar` below this becomes `retocar`
  laneConfidence: 0.5, // below this the lane is shown as tentative
});

const DEPTH_ORDER = ["ignorar", "anotar", "profundizar"];
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;

export class JevError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "JevError";
    this.code = code;
    this.status = options.status;
  }
}

function assertQuestions(questions) {
  const ids = Object.keys(questions || {});
  if (ids.length < 1) throw new JevError("invalid_request", "At least one question is required.");
  for (const [id, question] of Object.entries(questions)) {
    if (!["choice", "score", "noul"].includes(question?.type)) {
      throw new JevError("invalid_request", `Question ${id} has an unsupported type.`);
    }
    if (question.type === "choice" && (!question.criteria || Array.isArray(question.criteria))) {
      throw new JevError("invalid_request", `Choice question ${id} needs a map of option -> description.`);
    }
    if (question.type === "score" && (!Array.isArray(question.criteria) || question.criteria.length < 2)) {
      throw new JevError("invalid_request", `Score question ${id} needs an ordered array of levels.`);
    }
  }
}

// A wrong answer is a failed call, never coerced into a valid one: a label
// outside the criteria or a missing question means the classifier did not
// answer what was asked, and acting on it would be acting on a guess.
function validateAnswers(answers, questions) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new JevError("invalid_response", "Response carries no answers object.");
  }
  const out = {};
  for (const [id, question] of Object.entries(questions)) {
    const answer = answers[id];
    if (!answer || typeof answer !== "object") {
      throw new JevError("invalid_response", `Answer for ${id} is missing.`);
    }
    if (question.type === "choice") {
      if (!Object.prototype.hasOwnProperty.call(question.criteria, answer.choice)) {
        throw new JevError("invalid_response", `Answer for ${id} names an option outside the criteria.`);
      }
    } else if (question.type === "score") {
      const levels = question.criteria.length;
      if (!Number.isFinite(answer.score) || answer.score < 0 || answer.score > levels - 1) {
        throw new JevError("invalid_response", `Score for ${id} is outside its ${levels} levels.`);
      }
    } else if (typeof answer.noul !== "number") {
      throw new JevError("invalid_response", `Answer for ${id} carries no noul value.`);
    }
    const confidence = typeof answer.confidence === "number" ? answer.confidence : undefined;
    const probabilities = answer.probabilities && typeof answer.probabilities === "object"
      ? answer.probabilities
      : {};
    out[id] = { ...answer, confidence, probabilities };
  }
  return out;
}

async function post({ endpoint, apiKey, body, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new JevError("timeout", `No answer within ${timeoutMs} ms.`)), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body,
      signal: controller.signal,
    });
    if (response.status >= 500) throw new JevError("upstream", `Service answered ${response.status}.`, { status: response.status });
    if (!response.ok) throw new JevError("rejected", `Service answered ${response.status}.`, { status: response.status });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new JevError("invalid_response", "Response exceeds the size bound.");
    }
    try {
      return JSON.parse(text);
    } catch (cause) {
      throw new JevError("invalid_response", "Response is not JSON.", { cause });
    }
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    if (error instanceof JevError) throw error;
    throw new JevError("network", error.message, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One state, one set of questions, one validated answer set.
 * Retries once on timeout, network failure, or 5xx; a 4xx or a malformed
 * answer is final, because repeating the same request cannot fix either.
 */
export async function decide({
  state,
  questions,
  apiKey = process.env.TYPESAFE_API_KEY,
  endpoint = TYPESAFE_ENDPOINT,
  model = DEFAULT_MODEL,
  timeoutMs = 5_000,
  retries = 1,
  fetchImpl = fetch,
} = {}) {
  if (!apiKey) throw new JevError("missing_key", "TYPESAFE_API_KEY is not set.");
  assertQuestions(questions);
  const body = JSON.stringify({ state, model, questions });
  if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES) {
    throw new JevError("invalid_request", "State is too large; summarize it before sending.");
  }
  let attempt = 0;
  for (;;) {
    try {
      const value = await post({ endpoint, apiKey, body, timeoutMs, fetchImpl });
      return {
        model: value.model || model,
        answers: validateAnswers(value.answers, questions),
        usage: value.usage || {},
      };
    } catch (error) {
      const retryable = ["timeout", "network", "upstream"].includes(error.code);
      if (!retryable || attempt >= retries) throw error;
      attempt += 1;
    }
  }
}

/** Escalation only ever moves toward doing the work. */
export function gateDepth(answer, thresholds = THRESHOLDS) {
  let depth = answer.choice;
  let escalated = false;
  const step = () => {
    const index = DEPTH_ORDER.indexOf(depth);
    if (index < DEPTH_ORDER.length - 1) {
      depth = DEPTH_ORDER[index + 1];
      escalated = true;
    }
  };
  if (answer.confidence !== undefined && answer.confidence < thresholds.depthConfidence) step();
  const mass = answer.probabilities?.profundizar ?? 0;
  if (depth === "ignorar" && mass >= thresholds.profundizarFloor) step();
  return { depth, escalated };
}

/** `no_mandar` is never softened; a weak `enviar` becomes `retocar`. */
export function gateVerdict(answer, thresholds = THRESHOLDS) {
  if (answer.choice === "enviar" && (answer.confidence ?? 1) < thresholds.sendConfidence) {
    return { verdict: "retocar", escalated: true };
  }
  return { verdict: answer.choice, escalated: false };
}

export function phaseAQuestions(lanes) {
  return {
    depth: {
      type: "choice",
      instructions: "How should the assistant handle this inbox item as a complement filter?",
      criteria: {
        ignorar: "Noise, already handled, or no action for the user",
        anotar: "Worth noting on the board but no deep work now",
        profundizar: "Open context and propose or do concrete next steps now",
      },
    },
    bot: {
      type: "choice",
      instructions: "Which specialist lane fits best? (label only — Master deepens unless the user asks to involve a specialist)",
      criteria: lanes,
    },
    urgency: {
      type: "score",
      instructions: "Urgency for the user in the current work window",
      criteria: ["Later", "Today", "First thing / blocking"],
    },
  };
}

export const PHASE_B_QUESTIONS = Object.freeze({
  effort: {
    type: "choice",
    instructions: "How deep should the executor go on this item?",
    criteria: {
      rapido: "1–2 targeted tool calls; short answer or next-step line",
      a_fondo: "Full context: ticket/mail/code as needed, concrete plan or draft",
    },
  },
  executor_tier: {
    type: "choice",
    instructions: "Which executor class should the host run? The host maps this to a concrete model (see ORCHESTRATION.md).",
    criteria: {
      fast: "Light deepen; short factual next step",
      default: "Normal deepen with tools",
      strong: "Hard reasoning, multi-file, or ambiguous client risk",
    },
  },
});

/**
 * Both phases for one item. Phase B runs only when the gated depth is
 * `profundizar`. A failed call does not drop the item or guess its depth: it
 * comes back as `profundizar` marked `sinJev`, so the human sees it.
 */
export async function triageItem({ state, lanes, thresholds = THRESHOLDS, ...options }) {
  let phaseA;
  try {
    phaseA = await decide({ state, questions: phaseAQuestions(lanes), ...options });
  } catch (error) {
    return { depth: "profundizar", sinJev: true, error: error.code || "error", escalated: false };
  }
  const { depth, escalated } = gateDepth(phaseA.answers.depth, thresholds);
  const result = {
    depth,
    escalated,
    bot: phaseA.answers.bot.choice,
    botTentative: (phaseA.answers.bot.confidence ?? 1) < thresholds.laneConfidence,
    urgency: phaseA.answers.urgency.score,
    usage: [phaseA.usage],
  };
  if (depth !== "profundizar") return result;
  try {
    const phaseB = await decide({ state, questions: PHASE_B_QUESTIONS, ...options });
    result.effort = phaseB.answers.effort.choice;
    result.executor_tier = phaseB.answers.executor_tier.choice;
    result.usage.push(phaseB.usage);
  } catch (error) {
    // Depth is already decided; a lost Phase B costs only the effort hint.
    result.effort = "a_fondo";
    result.executor_tier = "default";
    result.sinJev = "phaseB";
    result.error = error.code || "error";
  }
  return result;
}
