package com.extention.backend.exception;


import org.springframework.http.*;

import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.HttpStatusCodeException;

import java.util.Map;

@ControllerAdvice
public class RestExceptionHandler {

    @ExceptionHandler(HttpStatusCodeException.class)
    public ResponseEntity<Map<String, Object>> handleHttpStatusCodeException(HttpStatusCodeException ex) {
        // Propagate upstream HTTP status; include upstream body snippet for debugging
        HttpStatus status = (HttpStatus) ex.getStatusCode();
        String upstreamBody = ex.getResponseBodyAsString();
        return ResponseEntity.status(status)
                .body(Map.of(
                        "code", "server_error",
                        "message", safeMessage(ex.getMessage()),
                        "upstream", truncate(upstreamBody, 2000)
                ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        // Default to 500; client will still parse the message and back off
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of(
                        "code", "server_error",
                        "message", safeMessage(ex.getMessage())
                ));
    }

    private static String safeMessage(String msg) {
        if (msg == null) return "";
        // Optional: replace newlines with <EOL> if you want to avoid multi-line headers
        // but the frontend already understands <EOL>. Keeping real newlines is fine.
        return msg;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}

