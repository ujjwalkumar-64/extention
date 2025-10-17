package com.extention.backend.controller;

import com.extention.backend.entity.OperationLog;
import com.extention.backend.service.OpsLogService;

import com.extention.backend.utils.AuthUserUtil;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/ops")
public class OpsController {

    private final OpsLogService opsLogService;

    public OpsController(OpsLogService opsLogService) {
        this.opsLogService = opsLogService;
    }

    // Persist log payload to DB and acknowledge in the shape the extension expects
    @PostMapping("/log")
    public ResponseEntity<Map<String, Object>> log(@RequestBody Map<String, Object> payload) {
        String username = currentUsernameOrAnonymous();
        OperationLog saved = opsLogService.saveFromPayload(username, payload);

        return ResponseEntity.ok(Map.of(
                "ok", true,
                "id", saved.getId(),
                "ts", saved.getCreatedAt() == null ? Instant.now().toEpochMilli() : saved.getCreatedAt().toEpochMilli()
        ));
    }

    // Optional: list recent logs for the current user (handy for debugging)
    @GetMapping("/recent")
    public ResponseEntity<List<OperationLog>> recent(@RequestParam(name = "limit", defaultValue = "50") int limit) {
        String username = currentUsernameOrAnonymous();
        int capped = Math.max(1, Math.min(100, limit));
        return ResponseEntity.ok(opsLogService.recentForUser(username, capped));
    }

    private String currentUsernameOrAnonymous() {
        try {
            String user = AuthUserUtil.requireUsername();
            return (user == null || user.isBlank()) ? "anonymousUser" : user;
        } catch (Exception e) {
            return "anonymousUser";
        }
    }
}