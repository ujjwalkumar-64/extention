package com.extention.backend.service.serviceImpl;


import com.extention.backend.controller.CompareConceptController;
import com.extention.backend.entity.Note;
import com.extention.backend.entity.Suggestion;
import com.extention.backend.repository.NoteRepository;
import com.extention.backend.repository.SuggestionRepository;
import com.extention.backend.service.CloudAiService;
import com.extention.backend.service.CompareConceptService;
import com.extention.backend.utils.AuthUserUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Comparator;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CompareConceptServiceImpl implements CompareConceptService {

    private final NoteRepository noteRepository;
    private final SuggestionRepository suggestionRepository;
    private final CloudAiService cloudAiService; // Your existing cloud AI adapter
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    @Transactional(readOnly = true)
    public CompareConceptController.CompareConceptResponse compare(String selectionText, String pageUrl) {
        String username = AuthUserUtil.requireUsername();

        // 1) Retrieve user KB: top 3 notes + top 2 suggestions (most recent)
        List<Note> notes = noteRepository.findTop3ByUsernameOrderByCreatedAtDesc(username);
        List<Suggestion> suggs = suggestionRepository.findTop2ByUsernameOrderByCreatedAtDesc(username);

        // 2) Build a compact context from notes and suggestions
        String kb = buildKnowledgeBase(notes, suggs);

        // 3) Build strict JSON prompt
        String prompt = """
            You are analyzing a user's newly selected text in the context of their personal knowledge base.

            Task:
            - Identify the single most important "key claim" in the selected text.
            - Based ONLY on the provided knowledge base context, write:
              1) One point of agreement (overlap, alignment, reinforcement).
              2) One point of contradiction OR, if none found, the most relevant difference/relation ("concept drift").
            - Keep it concise and specific to the context.

            Selected Text:
            %s

            User's Knowledge Base (summaries):
            %s

            IMPORTANT OUTPUT FORMAT:
            Return ONLY a single JSON object with these exact keys:
            {
              "key_claim": "<string>",
              "agreement": "<string>",
              "drift_analysis": "<string>"
            }
            Do not include markdown, code fences, or any extra commentary.
            """.formatted(safeSlice(selectionText, 1200), safeSlice(kb, 4000));

        // 4) Call AI
        String raw = cloudAiService.callGeminiApi(prompt);

        // 5) Parse: tolerate raw text with or without leading/trailing text by extracting first JSON object
        try {
            JsonNode node = extractFirstJsonObject(raw);
            String key = text(node, "key_claim");
            String agree = text(node, "agreement");
            String drift = text(node, "drift_analysis");

            return new CompareConceptController.CompareConceptResponse(
                    safeNonEmpty(key),
                    safeNonEmpty(agree),
                    safeNonEmpty(drift)
            );
        } catch (Exception e) {
            // Fallback: return minimal structured response
            return new CompareConceptController.CompareConceptResponse(
                    "Unable to parse key claim",
                    "No agreement extracted",
                    "No drift analysis extracted"
            );
        }
    }

    private String buildKnowledgeBase(List<Note> notes, List<Suggestion> suggs) {
        StringBuilder sb = new StringBuilder();
        // Notes: use categoriesJson.summary/topic if available, else content preview
        notes.stream()
                .sorted(Comparator.comparing(Note::getCreatedAt).reversed())
                .forEach(n -> {
                    String topic = null, summary = null;
                    try {
                        if (n.getCategoriesJson() != null) {
                            JsonNode c = objectMapper.readTree(n.getCategoriesJson());
                            topic = text(c, "topic");
                            summary = text(c, "summary");
                        }
                    } catch (Exception ignored) {}
                    if (topic == null || topic.isBlank()) topic = "Note";
                    String source = n.getSourceUrl() != null ? n.getSourceUrl() : "";
                    String content = n.getContent() != null ? n.getContent() : "";
                    sb.append("- Note: ").append(topic).append("\n");
                    if (!isBlank(summary)) sb.append("  Summary: ").append(safeSlice(summary, 300)).append("\n");
                    else sb.append("  Text: ").append(safeSlice(content, 300)).append("\n");
                    if (!isBlank(source)) sb.append("  Source: ").append(source).append("\n");
                });

        // Suggestions: title + reason
        suggs.stream()
                .sorted(Comparator.comparing(Suggestion::getCreatedAt).reversed())
                .forEach(s -> {
                    sb.append("- Suggestion: ").append(nvl(s.getTitle(), "Untitled")).append("\n");
                    if (!isBlank(s.getReason())) sb.append("  Why: ").append(safeSlice(s.getReason(), 280)).append("\n");
                    String url = nvl(s.getSuggestedUrl(), s.getBaseSourceUrl());
                    if (!isBlank(url)) sb.append("  Link: ").append(url).append("\n");
                });

        return sb.toString();
    }

    private JsonNode extractFirstJsonObject(String text) throws Exception {
        // Quick scan for first {...} block
        int start = text.indexOf('{');
        int end = text.lastIndexOf('}');
        if (start >= 0 && end > start) {
            String candidate = text.substring(start, end + 1);
            return objectMapper.readTree(candidate);
        }
        // If model already returns clean JSON
        return objectMapper.readTree(text);
    }

    private String text(JsonNode node, String field) {
        if (node == null) return "";
        var n = node.get(field);
        return n != null && !n.isNull() ? n.asText("") : "";
    }

    private boolean isBlank(String s) { return s == null || s.trim().isEmpty(); }

    private String nvl(String a, String b) { return isBlank(a) ? b : a; }

    private String safeSlice(String s, int max) {
        if (s == null) return "";
        String t = s.trim().replaceAll("\\s+", " ");
        return t.length() > max ? t.substring(0, max) + "…" : t;
    }

    private String safeNonEmpty(String s) { return isBlank(s) ? "—" : s.trim(); }
}
