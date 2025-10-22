package com.extention.backend.service;

import com.extention.backend.response.SearchItem;

import java.util.List;

public interface CloudSearchService {
    List<SearchItem> findSources(String text, String sourceUrl, String persona, int size);
}