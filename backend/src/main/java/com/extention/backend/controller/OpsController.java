package com.extention.backend.controller;

import lombok.Data;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/ops")
public class OpsController {

    @PostMapping("/log")
    public ResponseEntity<Map<String, Object>> log(@RequestBody Map<String, Object> payload) {
        // TODO: persist to DB if desired
        // For now, just acknowledge
        return ResponseEntity.ok(Map.of(
                "ok", true,
                "id", UUID.randomUUID().toString(),
                "ts", Instant.now().toEpochMilli()
        ));
    }
}