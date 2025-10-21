package com.extention.backend.controller;

import com.extention.backend.service.CloudSearchService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sources")
public class SourcesController {

    private final CloudSearchService cloudSearchService;

    public SourcesController(CloudSearchService cloudSearchService) {
        this.cloudSearchService = cloudSearchService;
    }

    @PostMapping("/find")
    public ResponseEntity<FindResponse> find(@RequestBody FindRequest req) {
        var items = cloudSearchService.findSources(req.text(), req.sourceUrl(), req.persona());
        return ResponseEntity.ok(new FindResponse(items));
    }

    public record FindRequest(String text, String sourceUrl, String persona) {}
    public record FindResponse(java.util.List<Suggestion> items) {}

    public static class Suggestion {
        public String url;
        public String title;
        public String reason;

        public Suggestion() {}
        public Suggestion(String url, String title, String reason) {
            this.url = url; this.title = title; this.reason = reason;
        }
    }
}
