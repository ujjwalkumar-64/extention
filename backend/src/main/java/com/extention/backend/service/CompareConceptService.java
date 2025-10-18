package com.extention.backend.service;


import com.extention.backend.controller.CompareConceptController;

public interface CompareConceptService {
    CompareConceptController.CompareConceptResponse compare(String selectionText, String pageUrl);
}
