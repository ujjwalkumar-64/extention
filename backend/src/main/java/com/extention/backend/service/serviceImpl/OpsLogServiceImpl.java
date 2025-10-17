package com.extention.backend.service.serviceImpl;


import com.extention.backend.entity.OperationLog;
import com.extention.backend.repository.OperationLogRepository;
import com.extention.backend.service.OpsLogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class OpsLogServiceImpl implements OpsLogService {

    private final OperationLogRepository repository;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Override
    public OperationLog saveFromPayload(String username, Map<String, Object> payload) {
        String opType = str(payload.get("type"));
        String sourceUrl = str(payload.get("source"));
        String targetLang = str(payload.get("targetLang"));

        String input = str(payload.get("input"));
        String output = str(payload.get("output"));

        String inputPreview = preview(input, 500);
        String outputPreview = preview(output, 500);

        String rawJson = toJsonSafe(payload);

        OperationLog log = OperationLog.builder()
                .username(StringUtils.hasText(username) ? username : "anonymousUser")
                .opType(nullToEmpty(opType))
                .sourceUrl(nullToEmpty(sourceUrl))
                .targetLang(nullToEmpty(targetLang))
                .inputPreview(inputPreview)
                .inputLength(len(input))
                .outputPreview(outputPreview)
                .outputLength(len(output))
                .rawPayloadJson(rawJson)
                .build();

        return repository.save(log);
    }

    @Override
    public List<OperationLog> recentForUser(String username, int limit) {
        // Simple implementation: reuse repository method and trim to limit
        List<OperationLog> all = repository.findTop100ByUsernameOrderByCreatedAtDesc(username);
        return all.size() > limit ? all.subList(0, limit) : all;
    }

    // Helpers

    private String str(Object o) {
        return (o == null) ? null : String.valueOf(o);
    }

    private int len(String s) {
        return s == null ? 0 : s.length();
    }

    private String preview(String s, int max) {
        if (s == null) return null;
        String trimmed = s.replaceAll("\\s+", " ").trim();
        return trimmed.length() > max ? trimmed.substring(0, max) + "…" : trimmed;
    }

    private String nullToEmpty(String s) {
        return s == null ? "" : s;
    }

    private String toJsonSafe(Object o) {
        try {
            return objectMapper.writeValueAsString(o);
        } catch (Exception e) {
            // Last resort: toString
            return String.valueOf(o);
        }
    }
}