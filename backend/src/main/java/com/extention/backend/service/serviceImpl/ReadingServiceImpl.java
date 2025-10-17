package com.extention.backend.service.serviceImpl;

import com.extention.backend.entity.Note;
import com.extention.backend.entity.Suggestion;
import com.extention.backend.repository.NoteRepository;
import com.extention.backend.repository.SuggestionRepository;
import com.extention.backend.service.AiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

@Service
@RequiredArgsConstructor
public class ReadingServiceImpl {
    private final NoteRepository noteRepository;
    private final SuggestionRepository suggestionRepository;
    @Qualifier("aiServiceImpl")
    private final AiService ai;
    private final ObjectMapper mapper = new ObjectMapper();

    @Transactional
    public List<Suggestion> suggestForUser(String username, String baseUrl, String baseSummary) {
        // Candidates from user's saved notes (distinct by sourceUrl)
        Map<String, String> urlToTitle = new LinkedHashMap<>();
        for (Note n : noteRepository.findByUsernameOrderByCreatedAtDesc(username)) {
            if (n.getSourceUrl() == null || Objects.equals(n.getSourceUrl(), baseUrl)) continue;
            // Fallback: no title stored—use URL as title placeholder
            urlToTitle.putIfAbsent(n.getSourceUrl(), n.getSourceUrl());
        }
        // Prepare candidates JSON array the AI can choose from
        var candidates = mapper.createArrayNode();
        urlToTitle.forEach((u, t) -> {
            var o = mapper.createObjectNode();
            o.put("url", u);
            o.put("title", t);
            candidates.add(o);
        });
        String suggestionsJson = ai.selectSuggestionsJson(baseSummary, candidates.toString());

        try {
            JsonNode node = mapper.readTree(suggestionsJson).path("suggestions");
            List<Suggestion> out = new ArrayList<>();
            for (int i = 0; i < Math.min(3, node.size()); i++) {
                JsonNode s = node.get(i);
                Suggestion saved = suggestionRepository.save(
                        Suggestion.builder()
                                .username(username)
                                .baseSourceUrl(baseUrl)
                                .suggestedUrl(s.path("url").asText(""))
                                .title(s.path("title").asText(""))
                                .reason(s.path("reason").asText(""))
                                .build()
                );
                out.add(saved);
            }
            return out;
        } catch (Exception e) {
            throw new RuntimeException("Failed to parse suggestions JSON: " + e.getMessage(), e);
        }
    }

    public List<Suggestion> recentSuggestions(String username) {
        return suggestionRepository.findTop10ByUsernameOrderByCreatedAtDesc(username);
    }
}