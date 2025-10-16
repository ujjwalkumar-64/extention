package com.extention.backend.service.serviceImpl;

import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import com.extention.backend.service.CloudAiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class AiServiceImpl implements AiService {
    @Autowired
    private  CloudAiService cloudAiService;

    private String createPrompt(AiRequest aiRequest){
        return switch (aiRequest.action()){
            case summarize ->  "Summarize the following text in 3 bullet points:\n"+ aiRequest.text();
            case rewrite -> "Rewrite this text with better tone and clarity:\\n" + aiRequest.text();
            case explain -> "Explain the following in simple English:\\n"+aiRequest.text();
            case translate -> "Translate the following text to " + aiRequest.targetLang() + ":\n"+aiRequest.text();
            case proofread -> "Proofread and correct grammatical errors:\n" + aiRequest.text();
            case flashcard->
                    "Generate a Q&A style flashcard from this text:\n" + aiRequest.text();

        };
    }

    @Override
    public AiResponse process(AiRequest aiRequest){
        String prompt= createPrompt(aiRequest);
        var output = cloudAiService.callGeminiApi(prompt);





        return AiResponse.builder()
                .result(output)
                .fromLocal(false)
                .build();

    }
}
