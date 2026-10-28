import { prisma, toNumber } from "../config/prisma.js";

const OLLAMA_URL =
  process.env.OLLAMA_URL || "http://127.0.0.1:11434";

const LOCAL_CHAT_MODEL =
  process.env.LOCAL_CHAT_MODEL || "qwen2.5:1.5b-instruct";

type AnalysisResult = {
  summary: string;
  flags: string[];
  severity: "low" | "moderate" | "high";
  recommendation: string;
  confidence: number;
};

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
        {
          role: "system",
          content: `You summarize medical reports for a doctor to review.
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
A licensed clinician must review the result.`,
        },
        {
          role: "user",
          content: `Summarize this medical report for clinician review:\n\n${reportText}`,
        },
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

  if (
    typeof parsed.summary !== "string" ||
    !Array.isArray(parsed.flags) ||
    !parsed.flags.every((flag) => typeof flag === "string") ||
    !["low", "moderate", "high"].includes(parsed.severity) ||
    typeof parsed.recommendation !== "string" ||
    typeof parsed.confidence !== "number" ||
    !Number.isFinite(parsed.confidence)
  ) {
    throw new Error("Local AI returned an unexpected response format.");
  }

  parsed.confidence = Math.max(
    0,
    Math.min(1, parsed.confidence)
  );

  return parsed;
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

  // Generate the analysis locally using Ollama.
  // No OpenAI API call or embedding model is used.
  const parsed = await generateLocalAnalysis(reportText);

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
        model_used: LOCAL_CHAT_MODEL,
        confidence: parsed.confidence,
      },
      select: { id: true, report_id: true, summary: true, findings: true, model_used: true, confidence: true, created_at: true },
    });
    return { ...saved, confidence: toNumber(saved.confidence) };
  } catch (e) {
    throw new Error(
      `Local AI analysis completed, but saving the result failed: ${e instanceof Error ? e.message : e}`
    );
  }
}