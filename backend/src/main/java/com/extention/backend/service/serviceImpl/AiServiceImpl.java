package com.extention.backend.service.serviceImpl;

import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import com.extention.backend.service.CloudAiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AiServiceImpl implements AiService {

    private final CloudAiService cloudAiService;
    private final ObjectMapper mapper = new ObjectMapper();

    private String createPrompt(AiRequest aiRequest) {
        String text = aiRequest.text();
        return switch (aiRequest.action()) {
            case summarize -> "Summarize the following text in 3 concise bullet points:\n" + text;
            case rewrite -> "Rewrite this text with better tone and clarity:\n" + text;
            case explain -> "Explain the following in simple English:\n" + text;
            case translate -> "Translate the following text to %s:\n%s".formatted(aiRequest.targetLang(), text);
            case proofread -> "Proofread and correct grammatical errors. Keep original meaning and voice:\n" + text;
            case flashcard -> "Generate a Q&A style flashcard from this text:\n" + text;
            case comment_code -> """
                Add clear, helpful explanatory comments to the following code without changing its behavior.
                Rules:
                - Use the appropriate comment syntax for the code's language (e.g., // or /* */ for C/Java/JS, # for Python, -- for SQL, etc.).
                - Keep comments concise and place them near lines they explain.
                - Do NOT wrap the output in Markdown code fences.
                - Return ONLY the fully commented code.

                Code:
                %s
                """.formatted(text);
        };
    }


    private String extractFirstJsonObject(String text) {
        try {
            // Try direct parse first
            JsonNode node = mapper.readTree(text);
            return node.toString();
        } catch (Exception ignored) {}
        // Fallback: naive extraction of first {...} block
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

    private String safe(String s) {
        return s == null ? "" : s;
    }

    @Override
    public AiResponse process(AiRequest aiRequest) {
        String prompt = createPrompt(aiRequest);
        String output = cloudAiService.callGeminiApi(prompt);
        return AiResponse.builder()
                .result(output)
                .fromLocal(false)
                .build();

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