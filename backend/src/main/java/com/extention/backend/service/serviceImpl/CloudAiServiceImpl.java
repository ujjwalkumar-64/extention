package com.extention.backend.service.serviceImpl;

import com.extention.backend.service.CloudAiService;
import com.fasterxml.jackson.core.JsonProcessingException;
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
    private final String BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

    @Override
    public String callGeminiApi(String prompt) {
        try {


            String url = BASE_URL + "?key=" + apiKey;
            String requestBody = String.format("""
                    {
                        "contents": [
                            {
                                "parts":[
                                    {
                                        "text":"%s"
                                    }
                                 ]
                            }
                        ]
                    }
                    """, prompt.replace("\"", "\\\""));

            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<String> request = new HttpEntity<>(requestBody, headers);

            ResponseEntity<String> response = restTemplate.exchange(url, HttpMethod.POST, request, String.class);
            ObjectMapper mapper = new ObjectMapper();
            JsonNode root = mapper.readTree(response.getBody());
            JsonNode textNode = root.path("candidates").get(0).path("content").path("parts").get(0).path("text");

            return textNode.asText();
        }
        catch (Exception e) {
            return "Error calling gemini api: " + e.getMessage();
        }
    }

}
