package com.extention.backend.controller;

import com.extention.backend.entity.Quiz;
import com.extention.backend.repository.QuizAttemptRepository;
import com.extention.backend.service.serviceImpl.QuizServiceImpl;
import com.extention.backend.utils.AuthUserUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/v1/quiz")
@RequiredArgsConstructor
public class QuizController {

    private final QuizServiceImpl quizService;
    private final QuizAttemptRepository attemptRepository;
    private final ObjectMapper objectMapper;

    public record AttemptDto(Long id, Long quizId, int score, int questionsCount, String articleTitle, Instant createdAt) {}

    public record GenerateRequest(String url) {}
    public record GenerateResponse(long id, String openUrl) {}

    public record GenerateFromTextRequest(String text, String title, String sourceUrl) {}
    public record GenerateFromTextResponse(Long id) {}

    @PostMapping("/generate-from-text")
    public ResponseEntity<GenerateFromTextResponse> generate(@RequestBody GenerateFromTextRequest req) {
        Long id = quizService.generateFromText(req.text(), req.title(), req.sourceUrl());
        return ResponseEntity.ok(new GenerateFromTextResponse(id));
    }

    @PostMapping("/generate")
    public ResponseEntity<GenerateResponse> generate(@RequestBody GenerateRequest req) {
        String username = AuthUserUtil.requireUsername();
        if (req.url() == null || req.url().isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        Quiz quiz = quizService.generateFromUrl(username, req.url());
        String openUrl = "/quiz/" + quiz.getId();
        return ResponseEntity.ok(new GenerateResponse(quiz.getId(), openUrl));
    }

    public record SubmitRequest(int[] answers) {}
    public record SubmitResponse(long attemptId, int score) {}

    @PostMapping("/{id}/submit")
    public ResponseEntity<SubmitResponse> submit(@PathVariable long id, @RequestBody SubmitRequest req) {
        String username = AuthUserUtil.requireUsername();
        var att = quizService.gradeAndStore(id, username, req.answers() == null ? new int[0] : req.answers());
        return ResponseEntity.ok(new SubmitResponse(att.getId(), att.getScore()));
    }

    @GetMapping("/attempts/recent")
    @Transactional(readOnly=true)
    public ResponseEntity<List<AttemptDto>> recent() {
        String username = AuthUserUtil.requireUsername();
        var res = attemptRepository.findTop20ByUsernameOrderByCreatedAtDesc(username);
        var list = res.stream()
                .map(a -> {
                    Quiz q = a.getQuiz();
                    int count = 0;
                    String title = "Quiz";
                    if (q != null) {
                        title = q.getArticleTitle() != null ? q.getArticleTitle() : title;
                        try {
                            String jq = q.getQuestionsJson();
                            if (jq != null) {
                                JsonNode node = objectMapper.readTree(jq);
                                count = node.path("questions").isArray() ? node.path("questions").size() : 0;
                            }
                        } catch (Exception ignore) {}
                    }
                    assert a.getQuiz() != null;
                    return new AttemptDto(a.getId(),a.getQuiz().getId(), a.getScore(), count, title, a.getCreatedAt());
                })
                .toList();
        return ResponseEntity.ok(list);
    }

    @GetMapping("/{id}")
    public ResponseEntity<JsonNode> getQuiz(@PathVariable long id) {
        String username = AuthUserUtil.requireUsername();
        return ResponseEntity.ok(quizService.getQuizQuestions(id, username));
    }
}