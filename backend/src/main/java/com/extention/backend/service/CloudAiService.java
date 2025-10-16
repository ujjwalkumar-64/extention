package com.extention.backend.service;

import org.springframework.stereotype.Service;

@Service
public interface CloudAiService {
    String callGeminiApi(String prompt);
}
