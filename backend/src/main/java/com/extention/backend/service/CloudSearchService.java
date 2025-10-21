package com.extention.backend.service;

import com.extention.backend.controller.SourcesController;

import java.util.List;

public interface CloudSearchService {
   List<SourcesController.Suggestion> findSources(String text, String sourceUrl, String persona);
}