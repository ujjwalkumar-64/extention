package com.extention.backend.controller;

import com.extention.backend.request.AiRequest;
import com.extention.backend.response.AiResponse;
import com.extention.backend.service.AiService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/ai")
public class AiController {
    @Autowired
    private AiService aiService;

    @PostMapping()
    ResponseEntity<?> process(@RequestBody AiRequest aiRequest){
        return ResponseEntity.ok(aiService.process(aiRequest));
    }

}
