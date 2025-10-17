package com.extention.backend.request;

public record CreateNoteRequest(String source, String content, Long ts) {}
