package com.extention.backend.service.serviceImpl;

import com.extention.backend.entity.Quiz;
import com.extention.backend.entity.QuizAttempt;
import com.extention.backend.mapper.ContentExtractor;
import com.extention.backend.repository.QuizAttemptRepository;
import com.extention.backend.repository.QuizRepository;
import com.extention.backend.service.AiService;
import com.extention.backend.utils.AuthUserUtil;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class QuizServiceImpl {

    private final ContentExtractor extractor;

    @Qualifier("aiServiceImpl")
    private final AiService ai;

    private final QuizRepository quizRepository;
    private final QuizAttemptRepository attemptRepository;
    private final ObjectMapper mapper = new ObjectMapper();

    @Transactional
    public Quiz generateFromUrl(String username, String url) {
        var content = extractor.extractFromUrl(url);
        String json = ai.generateQuizJson(content.title(), content.text());
        Quiz quiz = Quiz.builder()
                .username(username)
                .sourceUrl(url)
                .articleTitle(content.title())
                .questionsJson(json)
                .build();
        return quizRepository.save(quiz);
    }

    @Transactional
    public Long generateFromText(String text, String title, String sourceUrl) {
        if (text == null || text.isBlank()) {
            throw new IllegalArgumentException("text is required");
        }
        String username = AuthUserUtil.requireUsername();

        // IMPORTANT: Reuse the same pipeline as generateFromUrl to ensure identical JSON shape
        String questionsJson = ai.generateQuizJson(safeTitle(title), safeSlice(text, 5000));

        Quiz quiz = Quiz.builder()
                .username(username)
                .sourceUrl(sourceUrl)
                .articleTitle(safeTitle(title))
                .questionsJson(questionsJson)
                .build();
        quiz = quizRepository.save(quiz);
        return quiz.getId();
    }

    public JsonNode getQuizQuestions(long quizId, String username) {
        Quiz q = quizRepository.findById(quizId).orElseThrow();
        if (!q.getUsername().equals(username)) throw new RuntimeException("Forbidden");
        try {
            return mapper.readTree(q.getQuestionsJson());
        } catch (Exception e) {
            throw new RuntimeException("Stored quiz JSON invalid");
        }
    }

    @Transactional
    public QuizAttempt gradeAndStore(long quizId, String username, int[] answers) {
        Quiz q = quizRepository.findById(quizId).orElseThrow();
        if (!q.getUsername().equals(username)) throw new RuntimeException("Forbidden");

        try {
            var node = mapper.readTree(q.getQuestionsJson());
            var arr = node.path("questions");
            int correct = 0;
            int[] correctIdx = new int[arr.size()];
            for (int i = 0; i < arr.size(); i++) {
                int idx = arr.get(i).path("correctIndex").asInt(-1); // relies on AiService JSON shape
                correctIdx[i] = idx;
                if (i < answers.length && answers[i] == idx) correct++;
            }
            var answersNode = mapper.createObjectNode();
            var ansArr = answersNode.putArray("answers");
            for (int x : answers) ansArr.add(x);
            var corrArr = answersNode.putArray("correct");
            for (int x : correctIdx) corrArr.add(x);

            QuizAttempt att = QuizAttempt.builder()
                    .quiz(q)
                    .username(username)
                    .score(correct)
                    .answersJson(answersNode.toString())
                    .build();
            return attemptRepository.save(att);
        } catch (Exception e) {
            throw new RuntimeException("Failed to grade quiz: " + e.getMessage(), e);
        }
    }

    private String safeSlice(String s, int max) {
        if (s == null) return "";
        String t = s.trim();
        return t.length() > max ? t.substring(0, max) + "…" : t;
    }

    private String safeTitle(String t) {
        String title = (t == null || t.isBlank()) ? "Quick Quiz (Selection)" : t.trim();
        return title.length() > 200 ? title.substring(0, 200) : title;
    }
}