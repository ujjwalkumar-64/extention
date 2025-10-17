package com.extention.backend.service;

import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import org.springframework.stereotype.Service;

@Service
public interface AiService {
    AiResponse process(AiRequest aiRequest);
    String generateQuizJson(String title, String text);
    String categorizeNoteJson(String text);
    String selectSuggestionsJson(String baseSummary, String candidatesJson);


}
