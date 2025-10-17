package com.extention.backend.controller;
import com.extention.backend.entity.Quiz;
import com.extention.backend.service.serviceImpl.QuizServiceImpl;
import com.extention.backend.utils.AuthUserUtil;
import com.fasterxml.jackson.databind.JsonNode;

import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/quiz")
@RequiredArgsConstructor
public class QuizController {

    private final QuizServiceImpl quizService;

    public record GenerateRequest(String url) {}

    public record GenerateResponse(long id, String openUrl) {}

    @PostMapping("/generate")
    public ResponseEntity<GenerateResponse> generate(@RequestBody GenerateRequest req) {
        String username = AuthUserUtil.requireUsername();
        if (req.url() == null || req.url().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        Quiz quiz = quizService.generateFromUrl(username, req.url());
        // If you have a web UI page, adjust openUrl to your route (e.g., "/quiz/{id}")
        String openUrl = "/quiz/" + quiz.getId();
        return ResponseEntity.ok(new GenerateResponse(quiz.getId(), openUrl));
    }

    @GetMapping("/{id}")
    public ResponseEntity<JsonNode> getQuiz(@PathVariable long id) {
        String username = AuthUserUtil.requireUsername();
        return ResponseEntity.ok(quizService.getQuizQuestions(id, username));
    }

    public record SubmitRequest(int[] answers) {}
    public record SubmitResponse(long attemptId, int score) {}

    @PostMapping("/{id}/submit")
    public ResponseEntity<SubmitResponse> submit(@PathVariable long id, @RequestBody SubmitRequest req) {
        String username = AuthUserUtil.requireUsername();
        var att = quizService.gradeAndStore(id, username, req.answers() == null ? new int[0] : req.answers());
        return ResponseEntity.ok(new SubmitResponse(att.getId(), att.getScore()));
    }
}