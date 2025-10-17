package com.extention.backend.controller;


import com.extention.backend.entity.Suggestion;
import com.extention.backend.service.serviceImpl.ReadingServiceImpl;

import com.extention.backend.utils.AuthUserUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/v1/reading")
@RequiredArgsConstructor
public class ReadingController {

    private final ReadingServiceImpl readingService;

    public record SuggestRequest(String baseUrl, String baseSummary) {}

    @PostMapping("/suggest")
    public ResponseEntity<List<Suggestion>> suggest(@RequestBody SuggestRequest req) {
        String username = AuthUserUtil.requireUsername();
        if (req.baseUrl() == null || req.baseUrl().isBlank()) return ResponseEntity.badRequest().build();
        List<Suggestion> out = readingService.suggestForUser(username, req.baseUrl(), req.baseSummary() == null ? "" : req.baseSummary());
        return ResponseEntity.ok(out);
    }

    @GetMapping("/recent")
    public ResponseEntity<List<Suggestion>> recent() {
        String username = AuthUserUtil.requireUsername();
        return ResponseEntity.ok(readingService.recentSuggestions(username));
    }
}