package com.extention.backend.service.serviceImpl;

import com.extention.backend.entity.Action;
import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import com.extention.backend.service.CloudAiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@RequiredArgsConstructor
@Service
public class AiServiceImpl implements AiService {

    private final CloudAiService cloudAiService;
    private final ObjectMapper mapper = new ObjectMapper();

    @Override
    public AiResponse process(AiRequest aiRequest) {
        String prompt = createPrompt(aiRequest);
        String output = cloudAiService.callGeminiApi(prompt);
        return AiResponse.builder()
                .result(output)
                .fromLocal(false)
                .build();
    }

    // Persona-aware + citations + optional structured output for summarize/explain
    private String createPrompt(AiRequest req) {
        String text = safe(req.text());
        String persona = normalizePersona(req.persona());
        boolean cite = req.citeSources();
        boolean structured = req.structured();

        String personaDirectives = switch (persona) {
            case "student" -> "Persona: Student — explain simply, highlight key ideas, include brief examples when helpful.";
            case "researcher" -> "Persona: Researcher — precise, formal tone; include nuance and limitations; prefer technical accuracy.";
            case "editor" -> "Persona: Editor — improve clarity, structure, and style; correct grammar and concision.";
            default -> "Persona: General — balanced tone and clarity.";
        };

        String universal = """
                Preserve original meaning and intent. Preserve Markdown formatting and code blocks.
                If the input contains code, do not change identifiers or semantics.
                """;

        String citeDirective = cite
                ? "When possible, include citations or URLs explicitly present in the text. Do NOT fabricate sources."
                : "Do not add citations beyond those explicitly present in the text.";

        boolean isSummarize = req.action() == Action.summarize;
        boolean isExplain = req.action() == Action.explain;

        // If structured and summarize/explain, return JSON with bullets[] and citations[]
        if (structured && (isSummarize || isExplain)) {
            String task = isSummarize
                    ? "Summarize the following text into  concise bullet points."
                    : "Explain the following text clearly and structurally in  concise bullet points.";
            String schema = """
                    Output STRICT JSON (no extra text) matching:
                    {
                      "bullets": ["string", "..."],
                      "citations": [
                        { "url": "string", "title": "string", "note": "string (optional)" }
                      ]
                    }
                    Rules:
                    - bullets: concise and non-redundant.
                    - citations: only include URLs/titles explicitly present in the input. Do NOT fabricate.
                    - Omit 'note' if not needed.
                    """;
            return """
                    %s
                    %s
                    %s

                    Task:
                    %s
                    %s

                    Text:
                    %s
                    """.formatted(
                    personaDirectives.trim(),
                    universal.trim(),
                    citeDirective.trim(),
                    task.trim(),
                    schema.trim(),
                    text
            );
        }

        // Otherwise, return plain text for other ops (or non-structured)
        String opInstruction = switch (req.action()) {
            case summarize -> "Summarize the following text in concise bullet points.";
            case explain -> "Explain the following text with clear structure.";
            case rewrite -> "Rewrite the following text to improve clarity and style while preserving meaning and voice.";
            case translate -> "Translate the following text to %s. Preserve formatting, tone, and any Markdown or code blocks.".formatted(safe(req.targetLang()));
            case proofread -> "Proofread and correct grammatical errors while preserving meaning and voice. Return ONLY the corrected text.";
            case comment_code -> """
                    Add clear, helpful explanatory comments to the following code without changing its behavior.
                    Rules:
                    - Use the appropriate comment syntax for the code's language.
                    - Keep comments concise and place them near lines they explain.
                    - Do NOT wrap output in Markdown code fences.
                    - Return ONLY the fully commented code.
                    """;
        };

        // For rewrite/proofread/comment_code we avoid adding citations; for summarize/explain we follow citeDirective
        String citeBlock = (isSummarize || isExplain) ? citeDirective : "Do not add external references beyond what appears in the text.";

        return """
                %s
                %s
                %s

                Task:
                %s

                Text:
                %s
                """.formatted(
                personaDirectives.trim(),
                universal.trim(),
                citeBlock.trim(),
                opInstruction.trim(),
                text
        );
    }

    private String normalizePersona(String p) {
        if (p == null) return "general";
        String v = p.trim().toLowerCase();
        return switch (v) {
            case "student", "researcher", "editor" -> v;
            default -> "general";
        };
    }

    private String safe(String s) {
        return s == null ? "" : s;
    }

    // (unchanged helpers below shown from your original for completeness)
    private String extractFirstJsonObject(String text) {
        try {
            JsonNode node = mapper.readTree(text);
            return node.toString();
        } catch (Exception ignored) {}
        int i = text.indexOf('{');
        int brace = 0;
        for (int start = i; start >= 0 && start < text.length(); start = text.indexOf('{', start + 1)) {
            brace = 0;
            for (int j = start; j < text.length(); j++) {
                char c = text.charAt(j);
                if (c == '{') brace++;
                if (c == '}') brace--;
                if (brace == 0) {
                    String candidate = text.substring(start, j + 1);
                    try {
                        mapper.readTree(candidate);
                        return candidate;
                    } catch (Exception ignore) {}
                    break;
                }
            }
            if (start == -1) break;
        }
        throw new RuntimeException("AI did not return valid JSON");
    }

    @Override
    public String generateQuizJson(String title, String text) {
        String prompt = """
            You are a quiz generator. Create 5 multiple-choice questions (MCQs) based on the article below.
            Output STRICT JSON matching this schema:
            {
              "questions": [
                {
                  "question": "string",
                  "options": ["string","string","string","string"],
                  "correctIndex": 0,
                  "explanation": "string"
                }
              ]
            }
            Rules:
            - Exactly 5 questions.
            - 4 options per question.
            - Only one correct option per question (correctIndex 0..3).
            - Keep questions clear and unambiguous.
            - Do NOT include any text outside of the JSON.

            Title: %s
            Article:
            %s
            """.formatted(safe(title), safe(text));
        String raw = cloudAiService.callGeminiApi(prompt);
        return extractFirstJsonObject(raw);
    }

    @Override
    public String categorizeNoteJson(String text) {
        String prompt = """
            Categorize the note text. Return STRICT JSON:
            {
              "topic": "string",
              "relatedTo": ["string", "..."],
              "tags": ["string", "..."],
              "summary": "string"
            }
            Keep arrays to max 5 items each. No extra text.

            Text:
            %s
            """.formatted(safe(text));
        String raw = cloudAiService.callGeminiApi(prompt);
        return extractFirstJsonObject(raw);
    }

    @Override
    public String selectSuggestionsJson(String baseSummary, String candidatesJson) {
        String prompt = """
            You are a reading list curator. From the candidate list, pick the 3 most relevant items for the user.
            Return STRICT JSON:
            {
              "suggestions": [
                { "url": "string", "title": "string", "reason": "string" }
              ]
            }
            Criteria:
            - Relevance to the base summary.
            - Diversity of viewpoints where possible.
            - Avoid exact duplicates of the base source.
            - Keep reason to 1 sentence explaining why to read it next.

            Base Summary:
            %s

            Candidates:
            %s
            """.formatted(safe(baseSummary), candidatesJson);
        String raw = cloudAiService.callGeminiApi(prompt);
        return extractFirstJsonObject(raw);
    }
}