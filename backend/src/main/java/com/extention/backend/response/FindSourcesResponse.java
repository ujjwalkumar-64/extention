package com.extention.backend.response;

import java.util.List;

public class FindSourcesResponse {
    private List<SearchItem> items;

    public FindSourcesResponse() {}

    public FindSourcesResponse(List<SearchItem> items) {
        this.items = items;
    }

    public List<SearchItem> getItems() { return items; }
    public void setItems(List<SearchItem> items) { this.items = items; }
}