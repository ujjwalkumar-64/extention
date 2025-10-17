package com.extention.backend.service.serviceImpl;

import com.extention.backend.service.CloudAiService;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
@RequiredArgsConstructor
public class CloudAiServiceImpl implements CloudAiService {

    @Value("${application.config.GEMINI_API_KEY}")
    private String apiKey;

    private final RestTemplate restTemplate;
    private static final String BASE_URL =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Override
    public String callGeminiApi(String prompt) {
        try {
            String url = BASE_URL + "?key=" + apiKey;

            // Build request body safely
            String escaped = prompt.replace("\\", "\\\\").replace("\"", "\\\"");
            String requestBody = """
                    {
                      "contents": [
                        {
                          "parts": [
                            { "text": "%s" }
                          ]
                        }
                      ]
                    }
                    """.formatted(escaped);

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> request = new HttpEntity<>(requestBody, headers);

            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, request, String.class);
            if (!response.getStatusCode().is2xxSuccessful() || response.getBody() == null) {
                throw new RuntimeException("Gemini HTTP " + response.getStatusCodeValue());
            }

            JsonNode root = MAPPER.readTree(response.getBody());
            JsonNode candidates = root.path("candidates");
            if (!candidates.isArray() || candidates.isEmpty()) {
                throw new RuntimeException("No candidates in response");
            }
            JsonNode textNode = candidates.get(0)
                    .path("content")
                    .path("parts")
                    .path(0)
                    .path("text");

            if (textNode.isMissingNode() || textNode.isNull()) {
                throw new RuntimeException("No text in candidate");
            }

            return textNode.asText();
        } catch (Exception e) {
            // Re-throw so controller/advice returns proper non-2xx
            throw new RuntimeException("Gemini call failed: " + e.getMessage(), e);
        }
    }
}