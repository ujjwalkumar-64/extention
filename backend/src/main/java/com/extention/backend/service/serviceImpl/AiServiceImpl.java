package com.extention.backend.service.serviceImpl;

import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import com.extention.backend.service.CloudAiService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AiServiceImpl implements AiService {

    private final CloudAiService cloudAiService;

    private String createPrompt(AiRequest aiRequest) {
        String text = aiRequest.text();
        return switch (aiRequest.action()) {
            case summarize -> "Summarize the following text in 3 concise bullet points:\n" + text;
            case rewrite -> "Rewrite this text with better tone and clarity:\n" + text;
            case explain -> "Explain the following in simple English:\n" + text;
            case translate -> "Translate the following text to %s:\n%s".formatted(aiRequest.targetLang(), text);
            case proofread -> "Proofread and correct grammatical errors. Keep original meaning and voice:\n" + text;
            case flashcard -> "Generate a Q&A style flashcard from this text:\n" + text;
        };
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
}