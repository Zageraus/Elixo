import Anthropic from "@anthropic-ai/sdk";
import { prisma, toNumber } from "../config/prisma.js";

/**
 * Which model writes the report summaries:
 *   - "ollama" (default): a local model through Ollama, for running on a laptop.
 *   - "claude": Claude through the Anthropic API, for the deployed server where
 *     there is no Ollama. Needs ANTHROPIC_API_KEY.
 */
const AI_PROVIDER = (process.env.AI_PROVIDER || "ollama").toLowerCase();

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://127.0.0.1:11434";

const LOCAL_CHAT_MODEL =
  process.env.LOCAL_CHAT_MODEL || "qwen2.5:1.5b-instruct";

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

type AnalysisResult = {
  summary: string;
  flags: string[];
  severity: "low" | "moderate" | "high";
  recommendation: string;
  confidence: number;
};

const SYSTEM_PROMPT = `You summarize medical reports for a doctor to review.
Do not diagnose, prescribe medication, or invent findings.
Return only a JSON object with exactly these fields:
{
  "summary": "brief report summary",
  "flags": ["specific findings supported by the report"],
  "severity": "low",
  "recommendation": "appropriate next step for clinician review",
  "confidence": 0.5
}
severity must be exactly one of: low, moderate, high.
confidence must be a number between 0 and 1.
Use an empty flags array if no specific flags are supported.
If the report is unclear or insufficient, explicitly say so.
A licensed clinician must review the result.`;

const userPrompt = (reportText: string) =>
  `Summarize this medical report for clinician review:\n\n${reportText}`;

/** JSON schema for Claude's structured output, matching AnalysisResult. */
const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    flags: { type: "array", items: { type: "string" } },
    severity: { type: "string", enum: ["low", "moderate", "high"] },
    recommendation: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["summary", "flags", "severity", "recommendation", "confidence"],
  additionalProperties: false,
};

/** Checks the model's JSON has the expected shape and clamps confidence to 0..1. */
function validateAnalysis(parsed: AnalysisResult, source: string): AnalysisResult {
  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.flags) ||
    !parsed.flags.every((flag) => typeof flag === "string") ||
    !["low", "moderate", "high"].includes(parsed.severity) ||
    typeof parsed.recommendation !== "string" ||
    typeof parsed.confidence !== "number" ||
    !Number.isFinite(parsed.confidence)
  ) {
    throw new Error(`${source} returned an unexpected response format.`);
  }

  parsed.confidence = Math.max(
    0,
    Math.min(1, parsed.confidence)
  );

  return parsed;
}

async function generateLocalAnalysis(
  reportText: string
): Promise<AnalysisResult> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: LOCAL_CHAT_MODEL,
      stream: false,
      format: "json",
      options: {
        temperature: 0.2,
      },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(reportText) },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Local AI request failed (${response.status}). Check that Ollama is running and the model "${LOCAL_CHAT_MODEL}" is available.`
    );
  }

  const result = (await response.json()) as {
    message?: {
      content?: string;
    };
  };

  const content = result.message?.content;

  if (!content) {
    throw new Error("Local AI returned an empty response.");
  }

  let parsed: AnalysisResult;

  try {
    parsed = JSON.parse(content) as AnalysisResult;
  } catch {
    throw new Error("Local AI returned invalid JSON. Please try again.");
  }

  return validateAnalysis(parsed, "Local AI");
}

let anthropic: Anthropic | null = null;

async function generateClaudeAnalysis(
  reportText: string
): Promise<{ analysis: AnalysisResult; model: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("AI_PROVIDER is claude but ANTHROPIC_API_KEY isn't set on the server.");
  }
  anthropic ??= new Anthropic();

  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await anthropic.beta.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 16000,
      // If Claude declines on safety grounds, the API retries on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ANALYSIS_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(reportText) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      throw new Error("The Anthropic API key on the server was rejected.");
    } else if (e instanceof Anthropic.RateLimitError) {
      throw new Error("The AI service is busy right now. Please try again in a minute.");
    } else if (e instanceof Anthropic.APIError) {
      throw new Error(`AI request failed (${e.status}): ${e.message}`);
    }
    throw e;
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The AI declined to summarize this report.");
  }

  const text = response.content.find(
    (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text"
  )?.text;

  if (!text) {
    throw new Error("Claude returned an empty response.");
  }

  let parsed: AnalysisResult;

  try {
    parsed = JSON.parse(text) as AnalysisResult;
  } catch {
    throw new Error("Claude returned invalid JSON. Please try again.");
  }

  return { analysis: validateAnalysis(parsed, "Claude"), model: response.model };
}

export async function analyzeReport(params: {
  reportId: string;
  patientId: string;
  reportText: string;
}) {
  const { reportId, reportText } = params;

  if (!reportText.trim()) {
    throw new Error("Report text cannot be empty.");
  }

  let parsed: AnalysisResult;
  let modelUsed: string;

  if (AI_PROVIDER === "claude") {
    const result = await generateClaudeAnalysis(reportText);
    parsed = result.analysis;
    modelUsed = result.model;
  } else {
    parsed = await generateLocalAnalysis(reportText);
    modelUsed = LOCAL_CHAT_MODEL;
  }

  try {
    const saved = await prisma.ai_analyses.create({
      data: {
        report_id: reportId,
        summary: parsed.summary,
        findings: {
          flags: parsed.flags,
          severity: parsed.severity,
          recommendation: parsed.recommendation,
        },
        model_used: modelUsed,
        confidence: parsed.confidence,
      },
      select: { id: true, report_id: true, summary: true, findings: true, model_used: true, confidence: true, created_at: true },
    });
    return { ...saved, confidence: toNumber(saved.confidence) };
  } catch (e) {
    throw new Error(
      `AI analysis completed, but saving the result failed: ${e instanceof Error ? e.message : e}`
    );
  }
}
