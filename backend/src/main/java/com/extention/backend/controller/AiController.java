package com.extention.backend.controller;

import com.extention.backend.entity.Action;
import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
@RequestMapping({"/api/v1/ai", "/api/v1/ai"})
public class AiController {

    private final AiService aiService;

    @PostMapping
    public ResponseEntity<ExecuteResponse> execute(@RequestBody ExecuteRequest req) {
        Action action = toAction(req.action());
        if (action == null) {
            throw new IllegalArgumentException("Unsupported operation: " + req.action());
        }

        String persona = (req.persona() == null || req.persona().isBlank()) ? "general" : req.persona().trim().toLowerCase();
        boolean citeSources = Boolean.TRUE.equals(req.citeSources());
        boolean structured = Boolean.TRUE.equals(req.structured());

        AiRequest aiRequest = new AiRequest(req.text(), action, req.targetLang(), persona, citeSources, structured);
        AiResponse aiResponse = aiService.process(aiRequest);
        return ResponseEntity.ok(new ExecuteResponse(aiResponse.getResult()));
    }

    private Action toAction(String operation) {
        if (operation == null) return null;
        String op = operation.trim().toLowerCase();
        return switch (op) {
            case "summarize" -> Action.summarize;
            case "rewrite" -> Action.rewrite;
            case "explain" -> Action.explain;
            case "translate" -> Action.translate;
            case "proofread" -> Action.proofread;
            case "comment_code" -> Action.comment_code;
            default -> null;
        };
    }

    // Structured flag + persona + citeSources
    public record ExecuteRequest(String action, String text, String targetLang, String persona, Boolean citeSources, Boolean structured) {}
    public record ExecuteResponse(String output) {}
}