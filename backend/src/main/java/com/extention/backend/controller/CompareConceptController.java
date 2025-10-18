package com.extention.backend.controller;


import com.extention.backend.service.CompareConceptService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/ai")
@RequiredArgsConstructor
public class CompareConceptController {

    private final CompareConceptService compareConceptService;

    public record CompareConceptRequest(String selection_text, String page_url) {}
    public record CompareConceptResponse(String key_claim, String agreement, String drift_analysis) {}

    @PostMapping("/compare-concept")
    public ResponseEntity<CompareConceptResponse> compare(@RequestBody CompareConceptRequest req) {
        var out = compareConceptService.compare(req.selection_text(), req.page_url());
        return ResponseEntity.ok(out);
    }
}