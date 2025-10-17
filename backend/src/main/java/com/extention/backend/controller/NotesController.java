package com.extention.backend.controller;

import lombok.Data;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.UUID;

@RestController
@RequestMapping("/api/notes")
public class NotesController {

    @PostMapping
    public ResponseEntity<CreateNoteResponse> create(@RequestBody CreateNoteRequest req) {
        // TODO: persist note (source/url, content, ts) to storage
        return ResponseEntity.ok(new CreateNoteResponse(true, UUID.randomUUID().toString(), Instant.now().toEpochMilli()));
    }

    @Data
    public static class CreateNoteRequest {
        private String source;
        private String content;
        private Long ts;
    }

    public record CreateNoteResponse(boolean ok, String id, long ts) {}
}