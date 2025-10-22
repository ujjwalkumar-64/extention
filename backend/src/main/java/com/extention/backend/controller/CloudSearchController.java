package com.extention.backend.controller;

import com.extention.backend.request.FindSourcesRequest;
import com.extention.backend.response.FindSourcesResponse;
import com.extention.backend.response.SearchItem;
import com.extention.backend.service.CloudSearchService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;


@RestController
@RequestMapping("/api/v1/sources")
@RequiredArgsConstructor
public class CloudSearchController {

    private final CloudSearchService service;



    @PostMapping("/find")
    public ResponseEntity<FindSourcesResponse> find(@RequestBody FindSourcesRequest req) {
        int size = req.getSize() != null ? req.getSize() : 5;
        List<SearchItem> items = service.findSources(
                req.getText(),
                req.getSourceUrl(),
                req.getPersona(),
                size
        );
        return ResponseEntity.ok(new FindSourcesResponse(items));
    }
}