package com.extention.backend.request;

import com.extention.backend.entity.Action;

public record AiRequest(
        String text,
        Action action,
        String targetLang,
        String persona,      // "student" | "researcher" | "editor" | "general"
        boolean citeSources, // prefer citing if present in input
        boolean structured   // return structured JSON { bullets, citations } for summarize/explain
) {}